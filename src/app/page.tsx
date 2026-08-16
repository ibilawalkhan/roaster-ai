"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { requestOtp, signInWithPassword, verifyOtp } from "@/lib/supabase/auth";
import { Button, Input, Label } from "@/components/ui";
import { IconArrowRight, IconFlame } from "@/components/icons";

export default function Landing() {
  const router = useRouter();
  const { session, hydrated, error: storeError } = useStore();

  const [step, setStep] = useState<"phone" | "code" | "email">("phone");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once authenticated + linked, the store sets a role — send them onward.
  useEffect(() => {
    if (!hydrated) return;
    if (session.role === "admin") router.replace("/admin");
    else if (session.role === "employee") router.replace("/me");
  }, [hydrated, session.role, router]);

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      await requestOtp(phone);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code. Check the number.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      // On success the store loads and the redirect effect above fires.
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't work. Try again.");
      setBusy(false);
    }
  };

  const submitEmail = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword(email, password);
      // The store's auth listener loads the account; the redirect effect fires.
    } catch (e) {
      setError(e instanceof Error ? e.message : "That email or password wasn't right.");
      setBusy(false);
    }
  };

  if (!hydrated) return <Splash />;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-charcoal px-8 py-10 text-paper sm:px-14 sm:py-14">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #d75321, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #e0a020, transparent 70%)" }}
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ember text-white shadow-[0_4px_16px_rgba(215,83,33,0.5)]">
            <IconFlame width={22} height={22} />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Rosterly</span>
        </div>

        <div className="relative max-w-lg py-12">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium uppercase tracking-wider text-paper/70">
            <span className="h-1.5 w-1.5 rounded-full bg-ember-glow" /> Shift scheduling for restaurants
          </p>
          <h1 className="font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
            The roster,
            <br />
            <span className="text-ember-glow italic">off the spreadsheet.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-paper/70">
            Build two-week schedules, track everyone&rsquo;s hours, and let the team
            check their shifts from their phone — no more screenshots on WhatsApp.
          </p>
        </div>

        <p className="relative text-sm text-paper/45">
          Sign in with your mobile number. New here? Your manager adds you first.
        </p>
      </section>

      {/* Auth form */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-14">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            {step === "code" ? "Enter your code" : "Sign in"}
          </h2>
          <p className="mt-1 text-ink-soft">
            {step === "phone" && "We'll text you a one-time code."}
            {step === "code" && `Sent to ${phone}. Enter the 6-digit code.`}
            {step === "email" && "Managers can sign in with email instead."}
          </p>

          <div className="mt-8 space-y-4">
            {step === "email" ? (
              <>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@restaurant.com.au"
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && email && password && !busy && submitEmail()
                    }
                  />
                </div>
              </>
            ) : step === "phone" ? (
              <div>
                <Label htmlFor="phone">Mobile number</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="04xx xxx xxx"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && phone && !busy && sendCode()}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="nums tracking-[0.4em]"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && code.length >= 4 && !busy && submitCode()}
                />
              </div>
            )}

            {(error || storeError) && (
              <p className="rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] text-clay">
                {error ?? storeError}
              </p>
            )}

            {step === "email" ? (
              <div className="space-y-3">
                <Button
                  onClick={submitEmail}
                  disabled={!email || !password || busy}
                  className="w-full justify-center"
                >
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setPassword("");
                    setError(null);
                  }}
                  className="w-full text-center text-[13px] font-medium text-ink-soft hover:text-ink"
                >
                  Use my mobile instead
                </button>
              </div>
            ) : step === "phone" ? (
              <div className="space-y-3">
                <Button onClick={sendCode} disabled={!phone || busy} className="w-full justify-center">
                  {busy ? "Sending…" : (<>Send code <IconArrowRight width={16} height={16} /></>)}
                </Button>
                {/* M11 §3.1 — the manager fallback. Kept quiet: staff should
                    take the phone path, which is the one built for them. */}
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setError(null);
                  }}
                  className="w-full text-center text-[13px] font-medium text-ink-soft hover:text-ink"
                >
                  Manager? Sign in with email
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  onClick={submitCode}
                  disabled={code.length < 4 || busy}
                  className="w-full justify-center"
                >
                  {busy ? "Verifying…" : "Verify & sign in"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setCode("");
                    setError(null);
                  }}
                  className="w-full text-center text-[13px] font-medium text-ink-soft hover:text-ink"
                >
                  Use a different number
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-charcoal text-paper">
      <div className="flex items-center gap-3 opacity-80">
        <span className="grid h-10 w-10 animate-pulse place-items-center rounded-xl bg-ember text-white">
          <IconFlame width={22} height={22} />
        </span>
        <span className="font-display text-lg">Rosterly</span>
      </div>
    </div>
  );
}
