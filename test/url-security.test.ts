import test from "node:test";
import assert from "node:assert/strict";
import {
  safePrivacyUrl,
  safePublicBaseUrl,
  safeStripeCheckoutUrl,
  safeWebhookUrl,
} from "../server/url-security";

test("production webhook hedefi HTTPS allowlist ve public host ile sınırlıdır", () => {
  const previous = process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS;
  process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS = "crm.example.com";
  try {
    assert.equal(safeWebhookUrl("https://crm.example.com/hook", true), "https://crm.example.com/hook");
    assert.throws(() => safeWebhookUrl("https://evil.example/hook", true), /allowlist/i);
    assert.throws(() => safeWebhookUrl("https://127.0.0.1/hook", true), /özel veya yerel/i);
    assert.throws(() => safeWebhookUrl("https://[::1]/hook", true), /özel veya yerel/i);
    assert.throws(() => safeWebhookUrl("https://[::ffff:127.0.0.1]/hook", true), /özel veya yerel/i);
    assert.throws(() => safeWebhookUrl("http://crm.example.com/hook", true), /HTTPS/i);
    assert.throws(() => safeWebhookUrl("https://user:pass@crm.example.com/hook", true), /kullanıcı bilgisi/i);
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS;
    else process.env.INTEGRATION_WEBHOOK_ALLOWED_HOSTS = previous;
  }
});

test("public ve privacy URL değerleri güvenli şemalarla sınırlandırılır", () => {
  assert.equal(safePublicBaseUrl("https://voice.example.com/"), "https://voice.example.com");
  assert.throws(() => safePublicBaseUrl("http://voice.example.com"), /HTTPS origin/i);
  assert.throws(() => safePublicBaseUrl("https://voice.example.com/path"), /HTTPS origin/i);
  assert.equal(safePrivacyUrl("/#/privacy"), "/#/privacy");
  assert.throws(() => safePrivacyUrl("/\\evil.example/privacy"), /relative path veya HTTPS/i);
  assert.throws(() => safePrivacyUrl("javascript:alert(1)"), /relative path veya HTTPS/i);
});

test("Stripe Checkout yönlendirmesi yalnızca Stripe origin'ine gider", () => {
  assert.equal(
    safeStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_123#fidkdWxOYHwnPyd1blpxYHZxWjA0"),
    "https://checkout.stripe.com/c/pay/cs_test_123#fidkdWxOYHwnPyd1blpxYHZxWjA0",
  );
  assert.throws(() => safeStripeCheckoutUrl("https://checkout.stripe.com.evil.example/pay"), /güvenli olmayan/i);
  assert.throws(() => safeStripeCheckoutUrl("javascript:alert(1)"), /güvenli olmayan/i);
});
