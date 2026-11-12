import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

function safePath(v: unknown): string {
  if (typeof v !== "string") return "/";
  try {
    const u = new URL(v, "http://x");
    const p = u.pathname + u.search;
    return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/auth") ? p : "/";
  } catch {
    return "/";
  }
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {},
  head: () => ({
    meta: [
      { title: "Sign in — PayNudge" },
      {
        name: "description",
        content:
          "Sign in or create a PayNudge account to keep your invoices and reminders in one place.",
      },
      { property: "og:title", content: "Sign in — PayNudge" },
      {
        property: "og:description",
        content:
          "Sign in or create a PayNudge account to keep your invoices and reminders in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const target = safePath(search.redirect);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: target, replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: target, replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, target]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    const r = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (r.error) toast.error("Google sign-in didn't work. Try again.");
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-display text-4xl">
        {mode === "in" ? "Welcome back" : "Start chasing less"}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Your invoices and reminders stay in your own account.
      </p>
      <div className="paper mt-6 px-7 py-8">
        {sent ? (
          <p className="text-center">Check your email to confirm your account, then sign in.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "up" && (
              <Input
                placeholder="Your name or business"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <Input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" variant="paper" className="w-full" disabled={busy}>
              {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
            </Button>
            <Button type="button" variant="paper-outline" className="w-full" onClick={onGoogle}>
              Continue with Google
            </Button>
          </form>
        )}
      </div>
      <button
        type="button"
        className="mt-4 text-sm text-primary underline underline-offset-4"
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setSent(false);
        }}
      >
        {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
