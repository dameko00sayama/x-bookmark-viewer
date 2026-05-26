"use client";

type LoginPanelProps = {
  error: string | null;
};

export default function LoginPanel({ error }: LoginPanelProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[760px] flex-col justify-center px-6">
      <section className="rounded-lg border border-line bg-panel p-8 shadow-2xl shadow-black/30">
        <p className="mb-3 text-sm font-semibold text-quiet">X Bookmark Viewer</p>
        <h1 className="mb-4 text-3xl font-semibold tracking-normal text-white">
          ブックマークだけを静かに読む
        </h1>
        <p className="mb-6 leading-7 text-slate-300">
          X本体のタイムライン、通知、DM、検索を開かず、保存済みポストだけを表示します。
        </p>
        {error ? (
          <div className="mb-5 rounded-md border border-red-400/40 bg-red-950/40 p-4 text-sm text-red-100">
            {error}
          </div>
        ) : null}
        <a
          href="/api/auth/login"
          className="inline-flex rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-slate-200"
        >
          Xでログイン
        </a>
      </section>
    </main>
  );
}
