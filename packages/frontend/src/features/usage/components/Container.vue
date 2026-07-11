<script setup lang="ts">
import Card from "primevue/card";
import { onMounted, onUnmounted, ref } from "vue";

import PageHeader from "@/shared/components/PageHeader.vue";

type Section = {
  id: string;
  title: string;
};

const sections: Section[] = [
  { id: "how-it-works", title: "How it works" },
  { id: "getting-started", title: "Getting started" },
  { id: "attack-types", title: "Attack types" },
  { id: "commands", title: "Commands" },
  { id: "advanced-scan", title: "Advanced scan" },
  { id: "wordlists", title: "Wordlists" },
  { id: "results", title: "Reviewing results" },
  { id: "settings", title: "Settings" },
  { id: "tips", title: "Tips" },
];

const activeSection = ref<string>(sections[0]?.id ?? "");
const contentRef = ref<HTMLElement>();

const scrollToSection = (sectionId: string) => {
  document
    .getElementById(sectionId)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const handleScroll = () => {
  if (contentRef.value === undefined) return;

  const scrollPosition = contentRef.value.scrollTop + 120;

  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (section === undefined) continue;

    const element = document.getElementById(section.id);
    if (element !== null && element.offsetTop <= scrollPosition) {
      activeSection.value = section.id;
      break;
    }
  }
};

onMounted(() => {
  contentRef.value?.addEventListener("scroll", handleScroll);
});

onUnmounted(() => {
  contentRef.value?.removeEventListener("scroll", handleScroll);
});

const attackTypeInfo: { name: string; description: string }[] = [
  {
    name: "Query",
    description:
      "Injects candidate names into the URL query string (?name=value). This is the fastest surface to test and the best place to start.",
  },
  {
    name: "Body",
    description:
      "Injects candidate names into the request body. It works with form-encoded bodies and JSON. For JSON you can target a specific object with a JSONPath so parameters land in the right place.",
  },
  {
    name: "Headers",
    description:
      "Sends candidate names as request headers. This is useful for finding parameters like debug flags or feature toggles that the app reads from headers.",
  },
];

const commands: { name: string; description: string }[] = [
  {
    name: "Param Finder [QUERY]",
    description:
      "Starts a scan right away, testing names in the URL query string with your current settings.",
  },
  {
    name: "Param Finder [BODY]",
    description: "Starts a scan right away, testing names in the request body.",
  },
  {
    name: "Param Finder [HEADERS]",
    description:
      "Starts a scan right away, testing names as request headers.",
  },
  {
    name: "Param Finder [ADVANCED]",
    description:
      "Opens the Advanced Scan dialog so you can pick the attack type and override per-scan options (custom value, JSONPath, max parameters per request, cache-buster) before running.",
  },
];
</script>

<template>
  <div class="h-full flex flex-col gap-1 min-h-0">
    <PageHeader
      title="Usage"
      description="How to discover hidden HTTP parameters with ParamFinder."
    />

    <div class="flex-1 min-h-0 flex gap-1">
      <Card
        class="hidden md:flex shrink-0 w-52"
        :pt="{
          root: { style: 'display: flex; flex-direction: column;' },
          body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
          content: { class: 'flex-1 min-h-0 overflow-auto' },
        }"
      >
        <template #content>
          <nav class="p-2 space-y-0.5">
            <button
              v-for="section in sections"
              :key="section.id"
              type="button"
              class="w-full text-left px-3 py-2 rounded text-sm transition-colors"
              :class="
                activeSection === section.id
                  ? 'bg-surface-700 text-surface-100 font-medium'
                  : 'text-surface-200 hover:text-surface-100 hover:bg-surface-800'
              "
              @click="scrollToSection(section.id)"
            >
              {{ section.title }}
            </button>
          </nav>
        </template>
      </Card>

      <Card
        class="flex-1 min-h-0 h-full"
        :pt="{
          root: { style: 'display: flex; flex-direction: column;' },
          body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
          content: { class: 'flex-1 min-h-0 overflow-auto' },
        }"
      >
        <template #content>
          <div
            ref="contentRef"
            class="h-full overflow-auto scroll-smooth px-6 py-5"
          >
            <div class="max-w-2xl space-y-10 text-surface-300 leading-relaxed">
              <section id="how-it-works" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">
                  How it works
                </h3>
                <p>
                  ParamFinder discovers hidden HTTP parameters, meaning inputs
                  the server reads but that aren't referenced anywhere in the
                  page or documentation. Finding them can surface debug
                  switches, access-control bypasses, or forgotten functionality.
                </p>
                <p>
                  It runs in two phases. First it sends a small batch of
                  <span class="text-surface-100 font-medium">learning</span>
                  requests to build a baseline of how the target normally
                  responds, capturing status codes, response length, reflected
                  content, headers, and timing. Then it enters
                  <span class="text-surface-100 font-medium">discovery</span>,
                  mutating requests with names from your wordlists and packing
                  many candidates into each request. When a response deviates
                  from the baseline, ParamFinder bisects the batch to isolate
                  which single parameter caused the change and reports it as a
                  finding.
                </p>
                <p>
                  Because it compares against a learned baseline rather than
                  looking for fixed signatures, it adapts to each target. The
                  settings below let you trade speed for accuracy on noisy or
                  protected endpoints.
                </p>
              </section>

              <section id="getting-started" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">
                  Getting started
                </h3>
                <ol class="space-y-4">
                  <li class="flex gap-3">
                    <span
                      class="shrink-0 mt-0.5 w-6 h-6 grid place-items-center rounded-full bg-surface-700 text-surface-100 text-xs font-medium"
                      >1</span
                    >
                    <span>
                      Open the
                      <span class="text-surface-100 font-medium">Wordlists</span>
                      tab and import at least one wordlist. Enable it for the
                      attack types you want to test.
                    </span>
                  </li>
                  <li class="flex gap-3">
                    <span
                      class="shrink-0 mt-0.5 w-6 h-6 grid place-items-center rounded-full bg-surface-700 text-surface-100 text-xs font-medium"
                      >2</span
                    >
                    <span>
                      Right-click any HTTP request in HTTP History, Replay, or
                      any request editor and choose a
                      <span class="text-surface-100 font-medium">Param Finder</span>
                      command. The command palette
                      <code
                        class="px-1.5 py-0.5 rounded bg-surface-700 font-mono text-xs text-surface-100"
                        >Ctrl/Cmd+Shift+P</code
                      >
                      works too.
                    </span>
                  </li>
                  <li class="flex gap-3">
                    <span
                      class="shrink-0 mt-0.5 w-6 h-6 grid place-items-center rounded-full bg-surface-700 text-surface-100 text-xs font-medium"
                      >3</span
                    >
                    <span>
                      Track progress and review results in the
                      <span class="text-surface-100 font-medium">Sessions</span>
                      tab.
                    </span>
                  </li>
                </ol>
              </section>

              <section id="attack-types" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">
                  Attack types
                </h3>
                <p>
                  An attack type decides where candidate parameter names are
                  injected. Each scan targets one attack type, and wordlists are
                  enabled per attack type, so a wordlist only feeds the scans
                  you've turned it on for.
                </p>
                <div class="space-y-2">
                  <div
                    v-for="type in attackTypeInfo"
                    :key="type.name"
                    class="rounded-md border border-surface-600 bg-surface-800 px-4 py-3"
                  >
                    <span class="text-sm font-semibold text-surface-100">{{
                      type.name
                    }}</span>
                    <p class="text-sm text-surface-300 mt-1">
                      {{ type.description }}
                    </p>
                  </div>
                </div>
              </section>

              <section id="commands" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">Commands</h3>
                <p>
                  ParamFinder registers these commands on requests across Caido.
                  Trigger them from a request's right-click menu or from the
                  command palette
                  <code
                    class="px-1.5 py-0.5 rounded bg-surface-700 font-mono text-xs text-surface-100"
                    >Ctrl/Cmd+Shift+P</code
                  >. Selecting multiple rows starts a scan for each request.
                </p>
                <div class="space-y-2">
                  <div
                    v-for="command in commands"
                    :key="command.name"
                    class="rounded-md border border-surface-600 bg-surface-800 px-4 py-3"
                  >
                    <span class="font-mono text-sm text-surface-100">{{
                      command.name
                    }}</span>
                    <p class="text-sm text-surface-300 mt-1">
                      {{ command.description }}
                    </p>
                  </div>
                </div>
              </section>

              <section id="advanced-scan" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">
                  Advanced scan
                </h3>
                <p>
                  The Advanced Scan dialog, opened by the
                  <span class="text-surface-100 font-medium"
                    >Param Finder [ADVANCED]</span
                  >
                  command, lets you override options for a single scan without
                  changing your saved settings.
                </p>
                <ul class="list-disc pl-5 space-y-2 marker:text-surface-400">
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Custom parameter value</span
                    >
                    sets the value assigned to each tested parameter. A random
                    suffix is appended so every parameter stays unique. Leave it
                    blank to use the default.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Max parameters per request</span
                    >
                    controls how many candidate names are packed into a single
                    request. Leave it empty to auto-detect the largest size the
                    server accepts, or lower it if the target rejects big
                    requests.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium">JSON body path</span>
                    applies to body attacks. It takes a JSONPath such as
                    <code
                      class="px-1.5 py-0.5 rounded bg-surface-700 font-mono text-xs text-surface-100"
                      >$.data.user</code
                    >
                    that points to the object where parameters are injected. Use
                    the tree picker to select it from the request body. If the
                    request has no body, a JSON body is generated for you.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Cache-buster parameter</span
                    >
                    applies to header attacks. It adds a random parameter so
                    cached responses don't hide real differences.
                  </li>
                </ul>
              </section>

              <section id="wordlists" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">Wordlists</h3>
                <p>
                  Wordlists are the pool of candidate parameter names
                  ParamFinder tries. Manage them in the
                  <span class="text-surface-100 font-medium">Wordlists</span>
                  tab.
                </p>
                <ul class="list-disc pl-5 space-y-2 marker:text-surface-400">
                  <li>
                    Import a
                    <span class="text-surface-100 font-medium">preset</span>
                    with one click, create your own, or paste and upload a
                    custom list.
                  </li>
                  <li>
                    Toggle each list
                    <span class="text-surface-100 font-medium">Enabled</span>
                    and assign the
                    <span class="text-surface-100 font-medium">attack types</span>
                    it applies to. Only enabled lists matching the scan's attack
                    type are used, so a scan won't run if nothing is enabled for
                    that type.
                  </li>
                </ul>
              </section>

              <section id="results" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">
                  Reviewing results
                </h3>
                <p>
                  Every scan you start becomes a session in the
                  <span class="text-surface-100 font-medium">Sessions</span>
                  tab. Each session shows live progress, the request being
                  tested, and stats such as how many requests have been sent.
                  You can pause, resume, or cancel a running session.
                </p>
                <p>
                  Confirmed parameters appear in the session's findings, and
                  discovery logs record what the engine did. Select a finding or
                  a sent request to load its full request and response. Those
                  details are fetched only when you select a row, which keeps
                  large scans responsive.
                </p>
              </section>

              <section id="settings" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">Settings</h3>
                <p>
                  The
                  <span class="text-surface-100 font-medium">Settings</span>
                  tab holds the defaults applied to new scans. Request settings
                  control timing and learning.
                </p>
                <ul class="list-disc pl-5 space-y-2 marker:text-surface-400">
                  <li>
                    <span class="text-surface-100 font-medium">Request delay</span>,
                    <span class="text-surface-100 font-medium"
                      >request timeout</span
                    >, and an optional
                    <span class="text-surface-100 font-medium">scan timeout</span>
                    bound how long a whole run may take.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Learn requests count</span
                    >
                    is the number of baseline requests gathered before
                    discovery. The minimum is 3, and 6 or more is recommended
                    for noisy targets.
                  </li>
                </ul>
                <p>Advanced settings fine-tune detection.</p>
                <ul class="list-disc pl-5 space-y-2 marker:text-surface-400">
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Auto-detect max sizes</span
                    >
                    probes the largest URL, header, and body the server accepts.
                    Turn it off to set the limits manually.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium">WAF detection</span>
                    and
                    <span class="text-surface-100 font-medium"
                      >Ignore Cloudflare WAF blocks</span
                    >
                    keep firewall responses from becoming false findings.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Additional checks</span
                    >
                    and
                    <span class="text-surface-100 font-medium">Autopilot</span>
                    trade extra requests for fewer false positives by verifying
                    findings and adapting to the target.
                  </li>
                  <li>
                    <span class="text-surface-100 font-medium"
                      >Anomaly types to ignore</span
                    >
                    suppresses specific detectors that don't apply to the
                    target.
                  </li>
                </ul>
              </section>

              <section id="tips" class="scroll-mt-4 space-y-3">
                <h3 class="text-base font-semibold text-surface-100">Tips</h3>
                <ul class="list-disc pl-5 space-y-2 marker:text-surface-400">
                  <li>
                    Increase
                    <span class="text-surface-100 font-medium"
                      >Learn requests count</span
                    >
                    on noisy targets to reduce false positives.
                  </li>
                  <li>
                    Request and response details load only when you select a
                    row, which keeps large scans responsive.
                  </li>
                  <li>
                    Use
                    <span class="text-surface-100 font-medium"
                      >Anomaly types to ignore</span
                    >
                    to suppress detectors that don't apply to the target.
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>
