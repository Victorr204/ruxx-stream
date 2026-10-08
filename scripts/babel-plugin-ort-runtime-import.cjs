// ONNX Runtime's prebuilt browser bundles contain one lazy loader of the
// form `import(/*…*//*@vite-ignore*/url)` (its proxy-worker shim). Metro's
// dependency collector refuses dynamic import() calls whose argument is not
// a static string, so `expo export --platform web` fails on the raw file.
// The URL is runtime data in every build of ort.*, so the correct fix is to
// keep it out of Metro's static analysis: rewrite the call to
// `new Function("u", "return import(u)")(url)`, which the browser executes
// unchanged. Only files under node_modules/onnxruntime-web are touched.
//
// Wired up from babel.config.js.

module.exports = function babelPluginOrtRuntimeImport() {
  const t = require("@babel/core").types;

  const isStatic = (arg) =>
    arg.type === "StringLiteral" ||
    (arg.type === "TemplateLiteral" && arg.expressions.length === 0);

  const rewrite = (path, arg) => {
    if (!arg || isStatic(arg)) return;
    const factory = t.callExpression(
      t.newExpression(t.identifier("Function"), [
        t.stringLiteral("u"),
        t.stringLiteral("return import(u)"),
      ]),
      []
    );
    path.replaceWith(t.callExpression(factory, [arg]));
  };

  const inOnnxRuntime = (state) =>
    String(state.file.opts.filename || "").includes("onnxruntime-web");

  return {
    name: "ort-runtime-import",
    visitor: {
      CallExpression(path, state) {
        if (path.node.callee.type !== "Import") return;
        if (!inOnnxRuntime(state)) return;
        rewrite(path, path.node.arguments[0]);
      },
      ImportExpression(path, state) {
        if (!inOnnxRuntime(state)) return;
        rewrite(path, path.node.source);
      },
    },
  };
};
