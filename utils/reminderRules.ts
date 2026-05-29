// Single source of truth lives in api/_lib/reminders.ts (so Vercel's function
// bundler reliably includes it without a cross-directory import). The frontend
// re-exports it here for convenient importing from components.
export * from '../api/_lib/reminders';
