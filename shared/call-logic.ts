import { callStateSchema, type CallState, type ConversationMessage } from "./schema";

export function updateCallState(text: string, previous?: CallState): CallState {
  const normalized = text.toLocaleLowerCase("tr");
  const state = callStateSchema.parse(previous || {});
  let intent = state.intent;
  if (/(randevu|rezervasyon|görüşme ayarla)/i.test(normalized)) intent = "randevu";
  else if (/(fiyat|ücret|kaç para|teklif|paket)/i.test(normalized)) intent = "fiyat";
  else if (/(destek|sorun|arıza|çalışmıyor|şikayet)/i.test(normalized)) intent = "destek";

  const nameMatch = text.match(/(?:adım|ismim|ben)\s+([A-Za-zÇĞİÖŞÜçğıöşü]{2,}(?:\s+[A-Za-zÇĞİÖŞÜçğıöşü]{2,})?)/i);
  const phoneMatch = text.match(/(?:\+?90[\s.-]?)?(?:0?5\d{2})[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/);
  const timeMatch = text.match(/\b(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i);
  const hourOnlyMatch = normalized.match(/\bsaat\s+([01]?\d|2[0-3])\b/);
  const spokenHourMatch = normalized.match(/(?:^|\s)saat\s+(yirmi\s+(?:bir|iki|üç)|(?:on\s+)?(?:bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz)|on|yirmi)(?=\s|$|[.,!?])/);
  const spokenHourValues: Record<string, number> = {
    bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9,
    on: 10, "on bir": 11, "on iki": 12, "on üç": 13, "on dört": 14, "on beş": 15,
    "on altı": 16, "on yedi": 17, "on sekiz": 18, "on dokuz": 19, yirmi: 20,
    "yirmi bir": 21, "yirmi iki": 22, "yirmi üç": 23,
  };
  const relativeDate = normalized.match(/\b(bugün|yarın|öbür gün|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\b/);
  const numericDate = text.match(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](20\d{2}))?\b/);
  const requestedDate = relativeDate?.[1]
    || (numericDate ? `${numericDate[1]}.${numericDate[2]}${numericDate[3] ? `.${numericDate[3]}` : ""}` : null)
    || state.requestedDate;
  let parsedHour = hourOnlyMatch ? Number(hourOnlyMatch[1]) : spokenHourMatch ? spokenHourValues[spokenHourMatch[1]] : null;
  if (parsedHour !== null && parsedHour < 12 && /(öğleden sonra|akşam|gece)/.test(normalized)) parsedHour += 12;
  const requestedTime = timeMatch
    ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    : parsedHour !== null
      ? `${String(parsedHour).padStart(2, "0")}:00`
      : state.requestedTime;
  const name = nameMatch?.[1]?.trim() || state.name;
  const phone = phoneMatch?.[0]?.replace(/[^\d+]/g, "") || state.phone;
  const required = intent === "randevu"
    ? ["name", "phone", "requestedDate", "requestedTime"] as const
    : intent === "fiyat" || intent === "destek"
      ? ["name", "phone"] as const
      : [] as const;
  const values = { name, phone, requestedDate, requestedTime };
  const missingFields = required.filter((field) => !values[field]);
  const detail = intent === "randevu" && (requestedDate || requestedTime)
    ? ` — ${[requestedDate, requestedTime].filter(Boolean).join(" ")}`
    : "";
  const labels = { genel: "Genel görüşme", randevu: "Randevu talebi", fiyat: "Fiyat talebi", destek: "Destek kaydı" };

  return {
    intent,
    name,
    phone,
    requestedDate,
    requestedTime,
    summary: `${labels[intent]}${detail}`,
    missingFields: [...missingFields],
    completed: required.length > 0 && missingFields.length === 0,
  };
}

export function demoReply(text: string, history: ConversationMessage[], state: CallState) {
  const normalized = text.toLocaleLowerCase("tr");
  if (state.completed) {
    if (state.intent === "randevu") {
      return `${state.requestedDate} saat ${state.requestedTime} için talebinizi oluşturdum. Bilgileriniz temsilci onayına gönderildi.`;
    }
    return "Gerekli bilgileri aldım. Talebiniz ilgili temsilciye iletildi.";
  }
  const nextField = state.missingFields[0];
  if (nextField === "name") return "Talebinizi aldım. Size hitap edebilmem için adınızı soyadınızı söyler misiniz?";
  if (nextField === "phone") return "Teşekkür ederim. Size ulaşabileceğimiz telefon numaranızı alabilir miyim?";
  if (nextField === "requestedDate") return "Randevu için hangi gün sizin için uygun?";
  if (nextField === "requestedTime") return "O gün için tercih ettiğiniz saati söyler misiniz?";
  if (history.at(-1)?.content.toLocaleLowerCase("tr").includes("biraz daha açık")) {
    return "Randevu, fiyat bilgisi veya teknik destek konularından hangisi için aradınız?";
  }
  if (normalized.includes("merhaba") || normalized.includes("selam")) {
    return "Merhaba, hoş geldiniz. Randevu, fiyat veya destek konusunda size yardımcı olabilirim.";
  }
  return "Size yardımcı olabilmem için talebinizi biraz daha açık anlatır mısınız?";
}
