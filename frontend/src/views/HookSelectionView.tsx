// frontend/src/views/HookSelectionView.tsx
import { useState } from "react";
import { gfAction } from "../api/gf";
import Section from "../components/Section";
import type { ActionResponse, View } from "../api/types";

type HookSelectionViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
};

export default function HookSelectionView({
  resp,
  view,
  currentActorId,
  run,
}: HookSelectionViewProps) {
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const marshalId = meta.marshal_id ?? "";
  const hooks = meta.hooks ?? {};
  const suggestions: string[] = hooks.suggestions ?? [];
  const selectedFromBackend: string | null = hooks.selected_hook ?? null;

  const [selectedHook, setSelectedHook] = useState<string | null>(selectedFromBackend);
  const isMarshal = currentActorId === marshalId;

  async function beginTable() {
    const params: Record<string, any> = {
      actor_id: currentActorId,
    };

    if (selectedHook) {
      params.selected_hook = selectedHook;
    }

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.begin_table",
        params,
        view,
      })
    );
  }

  if (!isMarshal) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
          overflow: "auto",
          padding: 8,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: 820,
            width: "100%",
            border: "1px solid var(--border-strong)",
            borderRadius: 18,
            padding: 28,
            background: "var(--surface-bg)",
            textAlign: "center",
            display: "grid",
            gap: 20,
          }}
        >
          <div
            style={{
              fontFamily: "LavaArabic, serif",
              fontSize: "2.2rem",
              lineHeight: 1.2,
            }}
          >
            Marshal is choosing how the story begins...
          </div>

          <div style={{ opacity: 0.8, fontSize: "1.1rem" }}>
            The Fronteira is holding its breath.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 0,
        overflow: "auto",
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          width: "100%",
          border: "1px solid var(--border-strong)",
          borderRadius: 18,
          padding: 28,
          background: "var(--surface-bg)",
          display: "grid",
          gap: 22,
          maxHeight: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontFamily: "LavaArabic, serif",
            fontSize: "2.4rem",
            lineHeight: 1.2,
            textAlign: "center",
          }}
        >
          Pick one of the following narrative hooks:
        </div>

        <Section title="Story Hooks">
          <div style={{ display: "grid", gap: 12, maxHeight: "42vh", overflowY: "auto" }}>
            {suggestions.map((hook) => {
              const active = selectedHook === hook;

              return (
                <button
                  key={hook}
                  type="button"
                  onClick={() => setSelectedHook(hook)}
                  style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: active ? "2px solid var(--border-strong)" : "1px solid var(--border-muted)",
                  background: active ? "var(--surface-hover)" : "var(--surface-strong)",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1.4,
                  }}
                >
                  {hook}
                </button>
              );
            })}
          </div>
        </Section>

        <div
          style={{
            textAlign: "center",
            fontFamily: "LavaArabic, serif",
            fontSize: "2.5rem",
            opacity: 0.9,
          }}
        >
          or choose your own!!
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
          <button
            type="button"
            onClick={beginTable}
            style={{
              fontFamily: "LavaArabic, serif",
              fontSize: "3rem",
              letterSpacing: "0.04em",
              fontWeight: 900,
              color: "var(--accent-danger)",
              padding: "14px 28px",
              borderRadius: 16,
              border: "2px solid var(--border-strong)",
              background: "var(--surface-hover)",
              cursor: "pointer",
            }}
          >
            Bring the Frontier to life!!
          </button>
        </div>
      </div>
    </div>
  );
}
