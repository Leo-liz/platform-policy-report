await import("./migrate.mjs");

if (process.env.SEED_TEST_SUBSCRIPTION_ON_BUILD === "true") {
  await import("./seed-test-recipient.mjs");
} else {
  process.stdout.write(JSON.stringify({ ok: true, test_subscription_seeded: false }));
}
