"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  integrationGuides,
  type IntegrationId,
} from "@/lib/integrations-setup";

type ExportCapabilities = {
  github: boolean;
  githubGist: boolean;
  linear: boolean;
  notion: boolean;
};

function isConfigured(id: IntegrationId, exports: ExportCapabilities | null) {
  if (!exports) return false;
  if (id === "github") return exports.githubGist;
  if (id === "linear") return exports.linear;
  return exports.notion;
}

export function IntegrationsSetup() {
  const [exports, setExports] = useState<ExportCapabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/mission-control/health")
      .then((res) => res.json())
      .then((data) => setExports(data.exports ?? null))
      .catch(() => setExports(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-10">
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="font-heading text-lg font-semibold">Before you start</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Env vars are set on{" "}
            <strong className="text-foreground">Cloudflare → Workers &amp; Pages → revel → Settings → Variables and Secrets</strong>{" "}
            (as Secrets).
          </li>
          <li>Select Deploy after adding or changing variables.</li>
          <li>
            Exports run from any completed report —{" "}
            <Link href="/mission-control" className="text-primary hover:underline">
              run an analysis
            </Link>{" "}
            first if you do not have one yet.
          </li>
        </ol>
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <a
            href="https://developers.cloudflare.com/workers/configuration/secrets/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Cloudflare secrets docs
          </a>
        </Button>
      </div>

      {integrationGuides.map((guide) => {
        const configured = isConfigured(guide.id, exports);

        return (
          <section key={guide.id} id={guide.id}>
            <Card>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl" aria-hidden>
                      {guide.icon}
                    </p>
                    <CardTitle className="mt-2 text-xl">{guide.name}</CardTitle>
                    <p className="mt-2 max-w-2xl text-sm text-muted">
                      {guide.summary}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                      loading
                        ? "bg-background text-muted"
                        : configured
                          ? "bg-primary/10 text-primary"
                          : "bg-background text-muted"
                    }`}
                  >
                    {loading ? (
                      "Checking…"
                    ) : configured ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Configured
                      </>
                    ) : (
                      <>
                        <Circle className="h-3.5 w-3.5" />
                        Not configured
                      </>
                    )}
                  </span>
                </div>

                <div className="mt-6">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Environment variables
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {guide.envVars.map((v) => (
                      <li key={v.name} className="font-mono text-foreground">
                        {v.name}
                        {v.required ? (
                          <span className="ml-2 font-sans text-primary">required</span>
                        ) : (
                          <span className="ml-2 font-sans text-muted">optional</span>
                        )}
                        {v.hint ? (
                          <span className="mt-0.5 block font-sans text-muted">
                            {v.hint}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <ol className="mt-8 space-y-6">
                  {guide.steps.map((step, index) => (
                    <li key={step.title} className="flex gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{step.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted">
                          {step.body}
                        </p>
                        {step.code ? (
                          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs">
                            {step.code}
                          </pre>
                        ) : null}
                        {step.link ? (
                          <a
                            href={step.link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-sm text-primary hover:underline"
                          >
                            {step.link.label} →
                          </a>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-8 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    How to verify
                  </p>
                  <p className="mt-2 text-sm text-muted">{guide.verify}</p>
                </div>
              </CardContent>
            </Card>
          </section>
        );
      })}
    </div>
  );
}