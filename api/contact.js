const rateLimit = new Map();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limit: 同一IPから5分間に3回まで
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxRequests = 3;

  const entries = rateLimit.get(ip) || [];
  const recent = entries.filter((t) => now - t < windowMs);

  if (recent.length >= maxRequests) {
    return res.status(429).json({ error: "送信回数の上限に達しました。しばらく待ってから再度お試しください。" });
  }

  recent.push(now);
  rateLimit.set(ip, recent);

  // 古いエントリを定期的にクリーンアップ
  if (rateLimit.size > 1000) {
    for (const [key, val] of rateLimit) {
      if (val.every((t) => now - t > windowMs)) rateLimit.delete(key);
    }
  }

  const { name, email, company, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: "名前・メールアドレス・お問い合わせ内容は必須です。" });
  }

  // 簡易メールバリデーション
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "メールアドレスの形式が正しくありません。" });
  }

  // ハニーポット（フォーム側に hidden field "website" を設置）
  if (req.body.website) {
    // bot が自動入力した場合は静かに成功を返す
    return res.status(200).json({ ok: true });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "メール送信の設定に問題があります。" });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Tonos. お問い合わせ <noreply@romu.ai>",
        to: ["contact@romu.ai"],
        reply_to: email,
        subject: `【お問い合わせ】${company ? company + " " : ""}${name}様`,
        html: `
          <h2>romu.ai お問い合わせフォームからの送信</h2>
          <table style="border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;vertical-align:top;">お名前</td><td style="padding:8px 0;">${escapeHtml(name)}</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;vertical-align:top;">会社名</td><td style="padding:8px 0;">${escapeHtml(company || "（未入力）")}</td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;vertical-align:top;">メール</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
            <tr><td style="padding:8px 16px 8px 0;font-weight:bold;vertical-align:top;">内容</td><td style="padding:8px 0;white-space:pre-wrap;">${escapeHtml(message)}</td></tr>
          </table>
        `,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Resend error:", err);
      return res.status(500).json({ error: "メール送信に失敗しました。" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Contact API error:", e);
    return res.status(500).json({ error: "メール送信に失敗しました。" });
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
