import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBTITLE_LANGUAGES,
  batchLines,
  cueAt,
  cuesToSrt,
  detectLanguageLocally,
  detectionSample,
  flattenCueTexts,
  isSupportedLanguage,
  languageLabel,
  normalizeDetectedLanguage,
  parseSubtitles,
  pickTranslationSource,
  whisperChunksToCues,
} from "./subtitles.ts";

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there!

2
00:00:04,000 --> 00:00:06,000
Second line
across two rows

3
00:00:07,250 --> 00:00:09,000
<i>Styled</i> text
`;

test("parses SRT cues with start/end/text", () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { s: 1, e: 3.5, t: "Hello there!" });
  assert.equal(cues[1].t, "Second line\nacross two rows");
  assert.equal(cues[2].t, "Styled text");
});

test("parses WebVTT with header, cue ids and dot milliseconds", () => {
  const vtt = `WEBVTT

intro
00:00:01.500 --> 00:00:02.250 align:start
Welcome

00:01.000 --> 00:02.000
Minutes-only stamp
`;
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  // sorted by start: the minutes-only stamp (1.0s) comes first
  assert.equal(cues[0].s, 1);
  assert.equal(cues[0].e, 2);
  assert.equal(cues[1].s, 1.5);
  assert.equal(cues[1].e, 2.25);
});

test("tolerates BOM, CRLF and skips broken cues", () => {
  const messy =
    "\uFEFF1\r\n" +
    "00:00:01,000 --> 00:00:02,000\r\n" +
    "Fine\r\n" +
    "\r\n" +
    "2\r\n" +
    "not a timestamp --> still not\r\n" +
    "Broken\r\n" +
    "\r\n" +
    "3\r\n" +
    "00:00:05,000 --> 00:00:04,000\r\n" +
    "Backwards\r\n";
  const cues = parseSubtitles(messy);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].t, "Fine");
});

test("cueAt finds active cue and respects boundaries", () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cueAt(cues, 0.5), null);
  assert.equal(cueAt(cues, 1), "Hello there!");
  assert.equal(cueAt(cues, 3.49), "Hello there!");
  assert.equal(cueAt(cues, 3.5), null);
  assert.equal(cueAt(cues, 4.2), "Second line\nacross two rows");
  assert.equal(cueAt(cues, 99), null);
  assert.equal(cueAt([], 1), null);
});

test("cueAt prefers the latest-started cue on overlap", () => {
  const cues = [
    { s: 0, e: 10, t: "long" },
    { s: 2, e: 3, t: "pop" },
  ];
  assert.equal(cueAt(cues, 2.5), "pop");
  assert.equal(cueAt(cues, 4), "long");
});

test("flattenCueTexts keeps one line per cue", () => {
  const cues = [
    { s: 0, e: 1, t: "one\ntwo" },
    { s: 1, e: 2, t: "three" },
  ];
  assert.deepEqual(flattenCueTexts(cues), ["one / two", "three"]);
});

test("batchLines respects the character budget and keeps order", () => {
  const lines = ["aaaa", "bbbb", "cccc", "dddd", "eeee"];
  const batches = batchLines(lines, 10);
  assert.deepEqual(batches, [["aaaa", "bbbb"], ["cccc", "dddd"], ["eeee"]]);
  assert.deepEqual(
    batches.flat(),
    lines,
    "batches must reassemble back into the original order"
  );
});

test("language list exposes labels and support checks", () => {
  assert.ok(SUBTITLE_LANGUAGES.length >= 15);
  assert.equal(languageLabel("yo"), "Yoruba");
  assert.equal(languageLabel("xx"), "xx");
  assert.ok(isSupportedLanguage("zh-CN"));
  assert.ok(!isSupportedLanguage("klingon"));
});

test("normalizeDetectedLanguage maps detector tags onto our codes", () => {
  assert.equal(normalizeDetectedLanguage("ko"), "ko");
  assert.equal(normalizeDetectedLanguage("sw"), "sw");
  assert.equal(normalizeDetectedLanguage("zh"), "zh-CN");
  assert.equal(normalizeDetectedLanguage("zh-Hans"), "zh-CN");
  assert.equal(normalizeDetectedLanguage("zh-TW"), "zh-CN");
  assert.equal(normalizeDetectedLanguage("pt-BR"), "pt");
  assert.equal(normalizeDetectedLanguage(" pt "), "pt");
});

test("normalizeDetectedLanguage drops empty and undecided answers", () => {
  assert.equal(normalizeDetectedLanguage(null), null);
  assert.equal(normalizeDetectedLanguage(undefined), null);
  assert.equal(normalizeDetectedLanguage(""), null);
  assert.equal(normalizeDetectedLanguage("auto"), null);
  assert.equal(normalizeDetectedLanguage("und"), null);
});

test("pickTranslationSource prefers an exact hit, then English, then the first upload", () => {
  const rows = [
    { language: "fr" },
    { language: "en" },
    { language: "ko" },
  ];
  assert.equal(pickTranslationSource(rows, "ko")?.language, "ko");
  assert.equal(pickTranslationSource(rows, "de")?.language, "en");
  assert.equal(pickTranslationSource(rows, null)?.language, "en");
  assert.equal(pickTranslationSource([{ language: "yo" }], "en")?.language, "yo");
  assert.equal(pickTranslationSource([], "en"), null);
});

test("detectionSample flattens cues into one bounded string", () => {
  const cues = [
    { s: 0, e: 1, t: "First line\nsecond row" },
    { s: 1, e: 2, t: "   " },
    { s: 2, e: 3, t: "Third line" },
  ];
  assert.equal(detectionSample(cues), "First line second row Third line");
  assert.equal(detectionSample([]), "");

  const long = Array.from({ length: 40 }, (_, i) => ({
    s: i,
    e: i + 1,
    t: `cue number ${i} with a little text`,
  }));
  const sample = detectionSample(long, 120);
  assert.ok(sample.length <= 120, `sample was ${sample.length} chars`);
  assert.ok(sample.startsWith("cue number 0"));
  assert.ok(detectionSample(cues, 8) === "First line".slice(0, 8));
});

test("detectLanguageLocally reads non-Latin scripts straight off the page", () => {
  assert.equal(
    detectLanguageLocally("오늘 밤에 우리가 어디로 가야 하는지 아직도 모르겠어. 그 사람들은 결코 우리를 믿지 않았다."),
    "ko"
  );
  assert.equal(
    detectLanguageLocally("今日はどこへ行けばいいのかまだ分かっていない。彼らは決して私たちを信じていなかった。"),
    "ja"
  );
  assert.equal(
    detectLanguageLocally("今晚我们还不知道该去哪里。他们从来没有相信过我们现在必须马上离开这里。"),
    "zh-CN"
  );
  assert.equal(
    detectLanguageLocally(
      "Я не понимаю, почему все бегут по улицам этой ночью. Солнце садится над городом, и никто не хочет возвращаться домой."
    ),
    "ru"
  );
  assert.equal(
    detectLanguageLocally(
      "لا أفهم لماذا يركض الجميع في الشوارع هذه الليلة. الشمس تغرب فوق المدينة ولا أحد يريد العودة إلى المنزل."
    ),
    "ar"
  );
  assert.equal(
    detectLanguageLocally(
      "मैं नहीं समझता कि सब लोग इस रात सड़कों पर क्यों दौड़ रहे हैं। सूरज शहर के ऊपर डूब रहा है।"
    ),
    "hi"
  );
});

test("detectLanguageLocally scores Latin-script samples by their function words", () => {
  assert.equal(
    detectLanguageLocally(
      "I do not understand why everyone is running through the streets tonight. The sun is going down over the city and nobody seems to want to go home. We have to leave right now, it is too late to stay here."
    ),
    "en"
  );
  assert.equal(
    detectLanguageLocally(
      "Je ne comprends pas pourquoi tout le monde court dans cette scène. Le soleil se couche sur la ville et personne ne semble vouloir rentrer chez soi ce soir. Nous devons partir maintenant."
    ),
    "fr"
  );
  assert.equal(
    detectLanguageLocally(
      "Mi ko le mọ̀ pe kílọ̀ tí gbogbo ènìyàn ń ṣàwọ̀ ní orí ìjà. òtútùpọ̀ ń sun lórí ìlú, kì í ṣe énìkankan fẹ́ padà sí ilé. A gbọ́dọ̀ lọ báyìí."
    ),
    "yo"
  );
});

test("detectLanguageLocally stays quiet when it cannot really tell", () => {
  assert.equal(detectLanguageLocally(""), null);
  assert.equal(detectLanguageLocally("OK."), null);
  assert.equal(detectLanguageLocally("Ruxx Stream — coming soon"), null);
  // Thai is real text but not one of the languages we can label.
  assert.equal(
    detectLanguageLocally(
      "ฉันไม่เข้าใจว่าทำไมทุกคนถึงวิ่งไปตามถนนในคืนนี้ พระอาทิตย์กำลังตกเหนือเมืองและไม่มีใครอยากกลับบ้าน"
    ),
    null
  );
});

test("cuesToSrt round-trips through the parser", () => {
  const cues = [
    { s: 0, e: 1.5, t: "Opening line" },
    { s: 1.5, e: 2.001, t: "Second cue\nwith two rows" },
    { s: 3661.25, e: 3663, t: "An hour later" },
  ];
  const srt = cuesToSrt(cues);
  assert.ok(srt.includes("00:00:00,000 --> 00:00:01,500"));
  assert.ok(srt.includes("01:01:01,250 --> 01:01:03,000"));
  assert.deepEqual(parseSubtitles(srt), cues);
});

test("cuesToSrt never emits a cue the parser would drop", () => {
  const srt = cuesToSrt([{ s: 5, e: 5, t: "Zero width" }, { s: 5.0001, e: 5.0004, t: "Sub-ms" }]);
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2, "degenerate timings must be widened, not dropped");
  assert.ok(cues[0].e > cues[0].s);
  assert.ok(cues[1].e > cues[1].s);
});

test("whisperChunksToCues maps chunks and stays monotonic across seam overlap", () => {
  const cues = whisperChunksToCues([
    { s: 0, e: 4, t: "First chunk" },
    { s: 3.8, e: 8, t: "Second chunk" },
    { s: 8, e: 12, t: "  Third   chunk  " },
  ]);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].t, "First chunk");
  assert.equal(cues[2].t, "Third chunk");
  for (let i = 1; i < cues.length; i += 1) {
    assert.ok(cues[i].s >= cues[i - 1].e, `cue ${i} overlaps its predecessor`);
  }
});

test("whisperChunksToCues resolves open ends from the next chunk or duration", () => {
  const withNext = whisperChunksToCues([
    { s: 0, e: null, t: "Open ended" },
    { s: 5, e: 9, t: "Next" },
  ]);
  assert.equal(withNext[0].e, 5);

  const last = whisperChunksToCues([{ s: 40, e: null, t: "Final words" }], { duration: 50 });
  assert.equal(last[last.length - 1].e, 50);
  assert.equal(last[0].s, 40);
  for (const cue of last) assert.ok(cue.e - cue.s <= 7.5);
});

test("whisperChunksToCues skips empty chunks", () => {
  const cues = whisperChunksToCues([
    { s: 0, e: 3, t: "   " },
    { s: 3, e: 5, t: "Kept" },
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].t, "Kept");
});

test("whisperChunksToCues splits long text proportionally inside the character budget", () => {
  const sentence =
    "This is a very long whisper segment that easily exceeds the maximum characters we allow in one subtitle cue, so it has to be split. " +
    "The second sentence keeps going for a while as well to make sure both parts stay inside the budget.";
  const cues = whisperChunksToCues([{ s: 10, e: 24, t: sentence }]);
  assert.ok(cues.length >= 2, "one long segment must become several cues");
  for (const cue of cues) {
    assert.ok(cue.t.length <= 90, `cue was ${cue.t.length} chars`);
    assert.ok(cue.e > cue.s);
  }
  assert.equal(cues[0].s, 10);
  assert.equal(cues[cues.length - 1].e, 24);
  assert.equal(cues.map((cue) => cue.t).join(" ").replace(/\s+/g, " "), sentence);
});

test("whisperChunksToCues chops a long hold into readable timed parts", () => {
  const cues = whisperChunksToCues([{ s: 0, e: 21, t: "One short phrase held over a long silence" }]);
  assert.ok(cues.length >= 3, "a 21s hold must not stay on screen as one cue");
  for (const cue of cues) assert.ok(cue.e - cue.s <= 7.5);
  assert.equal(cues[cues.length - 1].e, 21);
});
