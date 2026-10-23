import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ForgotPasswordPage } from "@/components/auth/forgot-password-page";
import { isAuthConfigured } from "@/lib/auth-config";

// Decide at request time: auth secrets are runtime secrets on Cloudflare and
// are not visible to the build, so a build-time prerender would bake in the
// "auth not configured" redirect.
export const dynamic = "force-dynamic";

export default function ForgotPasswordRoute() {
  if (!isAuthConfigured()) {
    redirect("/mission-control");
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ForgotPasswordPage />
    </Suspense>
  );
}
