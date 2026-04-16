"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast-provider";
import { activateOnboarding } from "@/lib/api-client";

const STEPS = ["Create Tenant", "Configure Compliance", "Integrations", "Confirm + Activate"] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [tenantName, setTenantName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [callHours, setCallHours] = useState("09:00-18:00");
  const [complianceWindows, setComplianceWindows] = useState("Mon-Fri 09:00-18:00");
  const [retryRules, setRetryRules] = useState("3 attempts, 15m backoff");
  const [approvalThreshold, setApprovalThreshold] = useState("50000");
  const [twilioKey, setTwilioKey] = useState("");
  const [stripeKey, setStripeKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();

  const nextStep = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  const activate = async () => {
    setSaving(true);
    try {
      const payload = {
        tenantName,
        timezone,
        callHours,
        compliance: {
          callWindows: complianceWindows,
          retryRules,
          approvalThreshold,
        },
        integrations: {
          twilioConfigured: Boolean(twilioKey.trim()),
          stripeConfigured: Boolean(stripeKey.trim()),
          openAiConfigured: Boolean(openAiKey.trim()),
        },
      };
      window.localStorage.setItem("collectiq:onboarding", JSON.stringify(payload));
      await activateOnboarding();
      showToast({ title: "Tenant activated", variant: "success" });
      router.replace("/dashboard");
    } catch (error) {
      showToast({
        title: "Activation failed",
        description: (error as Error).message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Tenant Onboarding</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            Step {step + 1}: {STEPS[step]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {step === 0 ? (
            <>
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Tenant name" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              <input value={callHours} onChange={(e) => setCallHours(e.target.value)} placeholder="Allowed call hours (e.g. 09:00-18:00)" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
            </>
          ) : null}
          {step === 1 ? (
            <>
              <input value={complianceWindows} onChange={(e) => setComplianceWindows(e.target.value)} placeholder="Call windows" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              <input value={retryRules} onChange={(e) => setRetryRules(e.target.value)} placeholder="Retry rules" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              <input value={approvalThreshold} onChange={(e) => setApprovalThreshold(e.target.value)} placeholder="Approval threshold (cents)" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
            </>
          ) : null}
          {step === 2 ? (
            <>
              <input value={twilioKey} onChange={(e) => setTwilioKey(e.target.value)} placeholder="Twilio credentials / SID" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              <input value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} placeholder="Stripe key" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
              <input value={openAiKey} onChange={(e) => setOpenAiKey(e.target.value)} placeholder="OpenAI key" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
            </>
          ) : null}
          {step === 3 ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <div><span className="text-muted-foreground">Tenant:</span> {tenantName || "n/a"}</div>
              <div><span className="text-muted-foreground">Timezone:</span> {timezone}</div>
              <div><span className="text-muted-foreground">Call hours:</span> {callHours}</div>
              <div><span className="text-muted-foreground">Compliance:</span> {complianceWindows}, {retryRules}, threshold {approvalThreshold}</div>
              <div><span className="text-muted-foreground">Integrations:</span> Twilio {twilioKey ? "configured" : "missing"}, Stripe {stripeKey ? "configured" : "missing"}, OpenAI {openAiKey ? "configured" : "missing"}</div>
            </div>
          ) : null}
          <div className="flex justify-between pt-2">
            <Button variant="secondary" onClick={prevStep} disabled={step === 0 || saving}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={nextStep}>Next</Button>
            ) : (
              <Button onClick={activate} disabled={saving || !tenantName.trim()}>
                {saving ? "Activating..." : "Activate"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

