// A Stripe customer id saved in the database belongs to one Stripe mode (sandbox or live). After the
// switch to live, a profile that still holds a sandbox customer id would make every call that uses it
// fail with "No such customer". This tells that error apart from any other Stripe error, so checkout
// can start again with a fresh customer instead of stopping.
export function isMissingStripeCustomer(error) {
  const code = String(error?.code || error?.raw?.code || "");
  const message = String(error?.message || error?.raw?.message || "");
  if (/No such customer/i.test(message)) return true;
  return code === "resource_missing" && /customer/i.test(message);
}
