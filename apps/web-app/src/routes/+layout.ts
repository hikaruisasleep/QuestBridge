// QuestBridge ships a static frontend that the local host serves with a plain
// static file server; see docs/web-frontend.md.
//
// Prerendering is required rather than optional. `@sveltejs/adapter-static`
// fails the build when a route is dynamic (its `strict` default), and the
// prerendered shell is what lets the host return a real page — including the
// "host unreachable" and "not authorized" states — without running SvelteKit on
// the server or depending on the frontend at all.
//
// This applies to every route, including the Phase 3 `/overlay` and `/control`.
export const prerender = true;
