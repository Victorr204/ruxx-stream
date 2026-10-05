// Minimal ambient types so `tsc --noEmit` can type-check the Supabase Edge
// Functions (Deno runtime) alongside the React Native app.

declare namespace Deno {
  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
  const env: {
    get(key: string): string | undefined;
  };
}

declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}
