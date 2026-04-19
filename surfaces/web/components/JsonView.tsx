"use client";

import { Fragment } from "react";

/**
 * Hand-rolled JSON syntax highlighter.
 * No dependency, no `any` — recurses over unknown input.
 */

export interface JsonViewProps {
  value: unknown;
}

const INDENT = "  ";

function Key({ k }: { k: string }) {
  return (
    <span className="text-sky-700 dark:text-sky-300">{JSON.stringify(k)}</span>
  );
}

function Primitive({ v }: { v: unknown }) {
  if (v === null) {
    return <span className="text-neutral-500 italic">null</span>;
  }
  if (typeof v === "string") {
    return (
      <span className="text-emerald-700 dark:text-emerald-400">
        {JSON.stringify(v)}
      </span>
    );
  }
  if (typeof v === "number") {
    return (
      <span className="text-amber-600 dark:text-amber-400 tabular-nums">
        {String(v)}
      </span>
    );
  }
  if (typeof v === "boolean") {
    return (
      <span className="text-violet-600 dark:text-violet-400">{String(v)}</span>
    );
  }
  // Fallback — shouldn't hit for structured data but safe.
  return <span className="text-neutral-500">{JSON.stringify(v)}</span>;
}

function renderNode(value: unknown, indent: number): React.ReactNode {
  const pad = INDENT.repeat(indent);
  const padInner = INDENT.repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-neutral-500">[]</span>;
    }
    return (
      <>
        <span className="text-neutral-500">[</span>
        {"\n"}
        {value.map((item, i) => (
          <Fragment key={i}>
            {padInner}
            {renderNode(item, indent + 1)}
            {i < value.length - 1 && <span className="text-neutral-500">,</span>}
            {"\n"}
          </Fragment>
        ))}
        {pad}
        <span className="text-neutral-500">]</span>
      </>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-neutral-500">{"{}"}</span>;
    }
    return (
      <>
        <span className="text-neutral-500">{"{"}</span>
        {"\n"}
        {entries.map(([k, v], i) => (
          <Fragment key={k}>
            {padInner}
            <Key k={k} />
            <span className="text-neutral-500">: </span>
            {renderNode(v, indent + 1)}
            {i < entries.length - 1 && <span className="text-neutral-500">,</span>}
            {"\n"}
          </Fragment>
        ))}
        {pad}
        <span className="text-neutral-500">{"}"}</span>
      </>
    );
  }

  return <Primitive v={value} />;
}

export default function JsonView({ value }: JsonViewProps) {
  return (
    <pre
      className="font-mono text-neutral-800 dark:text-neutral-200 whitespace-pre"
      style={{ fontFeatureSettings: '"calt" off' }}
    >
      {renderNode(value, 0)}
    </pre>
  );
}
