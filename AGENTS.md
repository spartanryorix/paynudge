<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## PayNudge architecture
- Invoices and reminders live in Lovable Cloud (Supabase Postgres, row-level security per user) via `src/lib/paynudge/store.ts`; only the demo clock and a one-time import of older browser data use localStorage. PayPal stays the source of truth for payment status of real invoices.
- Server functions live in `src/lib/paynudge/paynudge.functions.ts`; server-only helpers live in `src/server/*.server.ts` — files under `src/server/` cannot be imported from client code.
- PayPal calls go through the Lovable connector gateway (`src/server/paypal.server.ts`); without `PAYPAL_API_KEY` the app runs in practice mode with local pay pages.
- Business rules (late days, reminder tone, totals, missing fields) live in `src/lib/paynudge/logic.ts` with tests beside it; the AI never computes numbers or dates.
- The PayPal webhook (`/api/public/paypal/webhook`) verifies the signature via PayPal and re-fetches the invoice; the dashboard also polls unpaid PayPal invoices every 10s as a backup.
