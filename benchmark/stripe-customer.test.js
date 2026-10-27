import test from "node:test";
import assert from "node:assert/strict";
import { isMissingStripeCustomer } from "../stripe-customer.js";

test("a customer that does not exist in this Stripe account is recognised", () => {
  assert.equal(isMissingStripeCustomer({ code: "resource_missing", message: "No such customer: 'cus_ABC'" }), true);
  assert.equal(isMissingStripeCustomer({ message: "No such customer: 'cus_ABC'; a similar object exists in test mode" }), true);
  assert.equal(isMissingStripeCustomer({ raw: { code: "resource_missing", message: "Customer not found" } }), true);
});

test("other Stripe errors are not mistaken for it", () => {
  assert.equal(isMissingStripeCustomer({ code: "resource_missing", message: "No such price: 'price_ABC'" }), false);
  assert.equal(isMissingStripeCustomer({ code: "rate_limit", message: "Too many requests" }), false);
  assert.equal(isMissingStripeCustomer(new Error("network down")), false);
  assert.equal(isMissingStripeCustomer(null), false);
  assert.equal(isMissingStripeCustomer(undefined), false);
});
