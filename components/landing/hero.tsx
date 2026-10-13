"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { BlindspotLabBadge } from "@/components/brand/blindspotlab-badge";
import { IllustrationSlot } from "@/components/landing/illustration-slot";
import { SectionIllustration } from "@/components/landing/section-illustration";
import { PUBLIC_SAMPLE_REPORT_PATH } from "@/lib/public-sample-report";
import { DEFAULT_WEEKLY_AUDIT_LIMIT } from "@/lib/weekly-audit-limit-config";

export function Hero() {
  return (
    <section className="hero-section illustration-section w-full">
      {/*
        Studio badge sits above both the headline and the hero artwork, in
        normal document flow, centred on desktop and mobile. It is a sibling of
        the two-column layout (not inside the copy column) so it centres against
        the full hero width rather than the text column.
      */}
      <div className="hero-section__badge mx-auto w-full max-w-6xl px-4 sm:px-6">
        <BlindspotLabBadge />
      </div>

      <div className="hero-section__layout mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 content-center items-center gap-6 px-4 sm:px-6 md:grid-cols-2 md:gap-12 lg:gap-16">
        <div className="hero-section__copy max-w-xl min-w-0">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="hero-section__heading font-heading font-semibold tracking-tight"
          >
            Find the hidden gaps stopping your product from growing.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className="mt-4 max-w-[680px] text-base leading-relaxed text-muted md:mt-5 md:text-lg"
          >
            Paste your website. Revel analyzes your product, user experience,
            messaging, and competitors, then generates a roadmap your team can
            actually execute.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            className="mt-5 flex flex-wrap gap-3 md:mt-6 md:gap-4"
          >
            <Button asChild size="lg">
              <Link href="/mission-control">Run Revel</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={PUBLIC_SAMPLE_REPORT_PATH}>See a Live Report</Link>
            </Button>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.15 }}
            className="mt-4 text-sm leading-snug text-muted md:mt-5"
          >
            Built for founders, product teams and builders. Free early access ·{" "}
            {DEFAULT_WEEKLY_AUDIT_LIMIT} audits / week ·{" "}
            <Link
              href="/pricing"
              className="text-primary underline-offset-2 hover:underline"
            >
              Access details
            </Link>
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="hero-section__art min-w-0 w-full"
        >
          <IllustrationSlot className="hero-illustration-slot">
            <SectionIllustration
              desktopSrc="/images/hero-peel-desktop-16x9.jpg"
              mobileSrc="/images/hero-peel-mobile-9x16.jpg"
              alt="Revel product analysis illustration"
              priority
            />
          </IllustrationSlot>
        </motion.div>
      </div>

      <div className="hero-section__scrim" aria-hidden="true" />
    </section>
  );
}
