import { callStateSchema, type CallState, type ConversationMessage } from "./schema";
import { normalizeLocale, type Locale } from "./i18n";

const intentPatterns: Record<Locale, Record<Exclude<CallState["intent"], "genel">, RegExp>> = {
  tr: {
    randevu: /(randevu|rezervasyon|görüşme\s+ayarla)/i,
    fiyat: /(fiyat|ücret|kaç\s+para|teklif|paket)/i,
    destek: /(destek|sorun|arıza|çalışmıyor|şikayet)/i,
  },
  en: {
    randevu: /(appointment|reservation|book(?:ing)?|schedule(?:\s+a\s+(?:call|meeting))?)/i,
    fiyat: /(price|pricing|cost|quote|package|how\s+much)/i,
    destek: /(support|problem|issue|broken|not\s+working|complaint|help\s+with)/i,
  },
  es: { randevu: /(cita|reserva|reservar|programar)/i, fiyat: /(precio|coste|costo|presupuesto|paquete)/i, destek: /(soporte|ayuda|problema|avería|no\s+funciona)/i },
  de: { randevu: /(termin|reservierung|buchen|vereinbaren)/i, fiyat: /(preis|kosten|angebot|paket)/i, destek: /(support|hilfe|problem|störung|funktioniert\s+nicht)/i },
  fr: { randevu: /(rendez-vous|réservation|réserver|planifier)/i, fiyat: /(prix|tarif|coût|devis|forfait)/i, destek: /(support|assistance|aide|problème|panne|ne\s+fonctionne\s+pas)/i },
  it: { randevu: /(appuntamento|prenotazione|prenotare|programmare)/i, fiyat: /(prezzo|costo|preventivo|pacchetto)/i, destek: /(supporto|assistenza|aiuto|problema|guasto|non\s+funziona)/i },
  pt: { randevu: /(agendamento|marcar|reserva|consulta)/i, fiyat: /(preço|valor|custo|orçamento|pacote)/i, destek: /(suporte|ajuda|problema|falha|não\s+funciona)/i },
  nl: { randevu: /(afspraak|reservering|boeken|inplannen)/i, fiyat: /(prijs|kosten|offerte|pakket)/i, destek: /(support|ondersteuning|hulp|probleem|storing|werkt\s+niet)/i },
  pl: { randevu: /(wizyta|spotkanie|rezerwacja|umówić)/i, fiyat: /(cena|koszt|wycena|oferta|pakiet)/i, destek: /(wsparcie|pomoc|problem|awaria|nie\s+działa)/i },
  ru: { randevu: /(запись|встреча|бронирование|записаться)/i, fiyat: /(цена|стоимость|тариф|предложение|пакет)/i, destek: /(поддержка|помощь|проблема|неисправность|не\s+работает)/i },
};

const spokenHours: Record<Locale, Record<string, number>> = {
  tr: {
    bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9,
    on: 10, "on bir": 11, "on iki": 12, "on üç": 13, "on dört": 14, "on beş": 15,
    "on altı": 16, "on yedi": 17, "on sekiz": 18, "on dokuz": 19, yirmi: 20,
    "yirmi bir": 21, "yirmi iki": 22, "yirmi üç": 23,
  },
  en: {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    "twenty one": 21, "twenty two": 22, "twenty three": 23,
  },
  es: { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, "veintiuna": 21, "veintiuno": 21, veintidós: 22, veintitrés: 23 },
  de: { eins: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, einundzwanzig: 21, zweiundzwanzig: 22, dreiundzwanzig: 23 },
  fr: { une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, "dix-sept": 17, "dix-huit": 18, "dix-neuf": 19, vingt: 20, "vingt et un": 21, "vingt-deux": 22, "vingt-trois": 23 },
  it: { una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20, ventuno: 21, ventidue: 22, ventitré: 23 },
  pt: { uma: 1, um: 1, duas: 2, dois: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, "vinte e uma": 21, "vinte e um": 21, "vinte e dois": 22, "vinte e três": 23 },
  nl: { één: 1, een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18, negentien: 19, twintig: 20, eenentwintig: 21, tweeëntwintig: 22, drieëntwintig: 23 },
  pl: { pierwsza: 1, jeden: 1, druga: 2, dwa: 2, trzecia: 3, trzy: 3, cztery: 4, pięć: 5, sześć: 6, siedem: 7, osiem: 8, dziewięć: 9, dziesięć: 10, jedenaście: 11, dwanaście: 12, trzynaście: 13, czternaście: 14, piętnaście: 15, szesnaście: 16, siedemnaście: 17, osiemnaście: 18, dziewiętnaście: 19, dwadzieścia: 20, "dwadzieścia jeden": 21, "dwadzieścia dwa": 22, "dwadzieścia trzy": 23 },
  ru: { один: 1, час: 1, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, "двадцать один": 21, "двадцать два": 22, "двадцать три": 23 },
};

const summaries: Record<Locale, Record<CallState["intent"], string>> = {
  tr: { genel: "Genel görüşme", randevu: "Randevu talebi", fiyat: "Fiyat talebi", destek: "Destek kaydı" },
  en: { genel: "General inquiry", randevu: "Appointment request", fiyat: "Pricing request", destek: "Support request" },
  es: { genel: "Consulta general", randevu: "Solicitud de cita", fiyat: "Solicitud de precio", destek: "Solicitud de soporte" },
  de: { genel: "Allgemeine Anfrage", randevu: "Terminanfrage", fiyat: "Preisanfrage", destek: "Supportanfrage" },
  fr: { genel: "Demande générale", randevu: "Demande de rendez-vous", fiyat: "Demande de tarif", destek: "Demande d’assistance" },
  it: { genel: "Richiesta generale", randevu: "Richiesta di appuntamento", fiyat: "Richiesta di prezzo", destek: "Richiesta di assistenza" },
  pt: { genel: "Consulta geral", randevu: "Solicitação de agendamento", fiyat: "Solicitação de preço", destek: "Solicitação de suporte" },
  nl: { genel: "Algemene vraag", randevu: "Afspraakverzoek", fiyat: "Prijsaanvraag", destek: "Supportverzoek" },
  pl: { genel: "Zapytanie ogólne", randevu: "Prośba o wizytę", fiyat: "Zapytanie o cenę", destek: "Prośba o wsparcie" },
  ru: { genel: "Общий запрос", randevu: "Запрос на запись", fiyat: "Запрос цены", destek: "Запрос поддержки" },
};

function extractName(text: string, locale: Locale) {
  const introductions: Record<Locale, string> = {
    tr: "adım|ismim|ben", en: "my\\s+name\\s+is|this\\s+is|i['’]?m",
    es: "me\\s+llamo|mi\\s+nombre\\s+es|soy", de: "ich\\s+heiße|mein\\s+name\\s+ist|ich\\s+bin",
    fr: "je\\s+m['’]appelle|mon\\s+nom\\s+est|je\\s+suis", it: "mi\\s+chiamo|il\\s+mio\\s+nome\\s+è|sono",
    pt: "meu\\s+nome\\s+é|eu\\s+sou|me\\s+chamo", nl: "ik\\s+heet|mijn\\s+naam\\s+is|ik\\s+ben",
    pl: "mam\\s+na\\s+imię|nazywam\\s+się|jestem", ru: "меня\\s+зовут|моё\\s+имя",
  };
  const pattern = new RegExp(`(?:${introductions[locale]})\\s+([\\p{L}][\\p{L}'’-]{1,}(?:\\s+[\\p{L}][\\p{L}'’-]{1,})?)`, "iu");
  return text.match(pattern)?.[1]?.trim() || null;
}

function extractTime(text: string, normalized: string, locale: Locale) {
  const timeWords: Record<Locale, string> = {
    tr: "saat", en: "at", es: "a\\s+las", de: "um", fr: "à", it: "alle", pt: "às", nl: "om", pl: "o", ru: "в",
  };
  const prefix = timeWords[locale];
  const numeric = text.match(new RegExp(`(?:\\b(?:${prefix})\\s*)?([01]?\\d|2[0-3])(?:[:.]([0-5]\\d))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?\\b`, "i"));
  if (numeric && (numeric[2] || numeric[3] || new RegExp(`(?:${prefix})\\s*$`, "i").test(text.slice(0, numeric.index)))) {
    let hour = Number(numeric[1]);
    const meridiem = numeric[3]?.toLowerCase().replaceAll(".", "");
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${numeric[2] || "00"}`;
  }

  const words = Object.keys(spokenHours[locale]).sort((a, b) => b.length - a.length).join("|");
  const spoken = normalized.match(new RegExp(`(?:^|\\s)(?:${prefix})\\s+(${words})(?=\\s|$|[.,!?])`, "iu"));
  if (!spoken) return null;
  let hour = spokenHours[locale][spoken[1]];
  const afternoon = /(?:öğleden\s+sonra|akşam|gece|afternoon|evening|tonight|tarde|noche|nachmittag|abend|après-midi|soir|pomeriggio|sera|middag|avond|popołudniu|wieczorem|дня|вечера|p\.?m\.?)/i;
  if (hour < 12 && afternoon.test(normalized)) {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:00`;
}

export function updateCallState(text: string, previous?: CallState, selectedLocale: Locale = "tr"): CallState {
  const locale = normalizeLocale(selectedLocale, "tr");
  const normalized = text.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US");
  const state = callStateSchema.parse(previous || {});
  let intent = state.intent;
  if (intentPatterns[locale].randevu.test(normalized)) intent = "randevu";
  else if (intentPatterns[locale].fiyat.test(normalized)) intent = "fiyat";
  else if (intentPatterns[locale].destek.test(normalized)) intent = "destek";

  const phoneMatch = text.match(/(?:\+?\d{1,3}[\s().-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{2,4}(?:[\s.-]?\d{2})?/);
  const relativePatterns: Record<Locale, RegExp> = {
    tr: /(?:^|\s)(bugün|yarın|öbür\s+gün|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)(?=\s|$|[.,!?])/,
    en: /(?:^|\s)(today|tomorrow|day\s+after\s+tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=\s|$|[.,!?])/,
    es: /(?:^|\s)(hoy|mañana|pasado\s+mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo)(?=\s|$|[.,!?])/,
    de: /(?:^|\s)(heute|morgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?=\s|$|[.,!?])/,
    fr: /(?:^|\s)(aujourd’hui|demain|après-demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?=\s|$|[.,!?])/,
    it: /(?:^|\s)(oggi|domani|dopodomani|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)(?=\s|$|[.,!?])/,
    pt: /(?:^|\s)(hoje|amanhã|depois\s+de\s+amanhã|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado|domingo)(?=\s|$|[.,!?])/,
    nl: /(?:^|\s)(vandaag|morgen|overmorgen|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)(?=\s|$|[.,!?])/,
    pl: /(?:^|\s)(dzisiaj|jutro|pojutrze|poniedziałek|wtorek|środa|czwartek|piątek|sobota|niedziela)(?=\s|$|[.,!?])/,
    ru: /(?:^|\s)(сегодня|завтра|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?=\s|$|[.,!?])/,
  };
  const relativePattern = relativePatterns[locale];
  const relativeDate = normalized.match(relativePattern);
  const numericDate = text.match(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](20\d{2}))?\b/);
  const requestedDate = relativeDate?.[1]
    || (numericDate ? `${numericDate[1]}.${numericDate[2]}${numericDate[3] ? `.${numericDate[3]}` : ""}` : null)
    || state.requestedDate;
  const requestedTime = extractTime(text, normalized, locale) || state.requestedTime;
  const name = extractName(text, locale) || state.name;
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

  return {
    intent,
    name,
    phone,
    requestedDate,
    requestedTime,
    summary: `${summaries[locale][intent]}${detail}`,
    missingFields: [...missingFields],
    completed: required.length > 0 && missingFields.length === 0,
  };
}

export function demoReply(
  text: string,
  history: ConversationMessage[],
  state: CallState,
  selectedLocale: Locale = "tr",
) {
  const locale = normalizeLocale(selectedLocale, "tr");
  const normalized = text.toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US");
  const replies: Record<Locale, {
    name: string; phone: string; date: string; time: string; clarify: string; greeting: string;
    complete: string; appointment: (date: string | null, time: string | null) => string;
  }> = {
    en: { name: "I have your request. May I have your full name?", phone: "Thank you. What is the best phone number to reach you?", date: "Which day would work best for the appointment?", time: "What time would you prefer that day?", clarify: "Could you tell me a little more detail about what you need?", greeting: "Hello, welcome. I can help with appointments, pricing, or support.", complete: "I have everything I need. Your request has been sent to the right representative.", appointment: (date, time) => `I've created your request for ${date} at ${time}. Your details have been sent for confirmation.` },
    tr: { name: "Talebinizi aldım. Size hitap edebilmem için adınızı soyadınızı söyler misiniz?", phone: "Teşekkür ederim. Size ulaşabileceğimiz telefon numaranızı alabilir miyim?", date: "Randevu için hangi gün sizin için uygun?", time: "O gün için tercih ettiğiniz saati söyler misiniz?", clarify: "Size yardımcı olabilmem için talebinizi biraz daha açık anlatır mısınız?", greeting: "Merhaba, hoş geldiniz. Randevu, fiyat veya destek konusunda size yardımcı olabilirim.", complete: "Gerekli bilgileri aldım. Talebiniz ilgili temsilciye iletildi.", appointment: (date, time) => `${date} saat ${time} için talebinizi oluşturdum. Bilgileriniz temsilci onayına gönderildi.` },
    es: { name: "He recibido su solicitud. ¿Me indica su nombre completo?", phone: "Gracias. ¿Cuál es el mejor número para contactarle?", date: "¿Qué día le viene mejor para la cita?", time: "¿A qué hora prefiere la cita?", clarify: "¿Puede contarme con un poco más de detalle qué necesita?", greeting: "Hola, bienvenido. Puedo ayudarle con citas, precios o soporte.", complete: "Ya tengo los datos necesarios. Su solicitud ha sido enviada al representante adecuado.", appointment: (date, time) => `He creado su solicitud para ${date} a las ${time}. Sus datos se han enviado para confirmación.` },
    de: { name: "Ich habe Ihr Anliegen aufgenommen. Wie lautet Ihr vollständiger Name?", phone: "Danke. Unter welcher Telefonnummer erreichen wir Sie am besten?", date: "Welcher Tag passt Ihnen für den Termin?", time: "Welche Uhrzeit bevorzugen Sie?", clarify: "Können Sie etwas genauer beschreiben, wobei Sie Hilfe benötigen?", greeting: "Hallo und willkommen. Ich helfe bei Terminen, Preisen oder Support.", complete: "Alle erforderlichen Angaben sind erfasst. Ihre Anfrage wurde weitergeleitet.", appointment: (date, time) => `Ihre Anfrage für ${date} um ${time} wurde erstellt und zur Bestätigung weitergeleitet.` },
    fr: { name: "J’ai bien reçu votre demande. Puis-je avoir votre nom complet ?", phone: "Merci. Quel est le meilleur numéro pour vous joindre ?", date: "Quel jour vous conviendrait pour le rendez-vous ?", time: "Quelle heure préférez-vous ce jour-là ?", clarify: "Pouvez-vous préciser un peu votre demande ?", greeting: "Bonjour et bienvenue. Je peux vous aider pour un rendez-vous, un tarif ou le support.", complete: "J’ai toutes les informations nécessaires. Votre demande a été transmise au bon interlocuteur.", appointment: (date, time) => `Votre demande pour ${date} à ${time} a été créée et envoyée pour confirmation.` },
    it: { name: "Ho ricevuto la richiesta. Posso avere il suo nome completo?", phone: "Grazie. Qual è il numero migliore per contattarla?", date: "Quale giorno preferisce per l’appuntamento?", time: "A che ora preferisce?", clarify: "Può descrivere un po’ meglio ciò di cui ha bisogno?", greeting: "Buongiorno e benvenuto. Posso aiutare con appuntamenti, prezzi o assistenza.", complete: "Ho tutte le informazioni necessarie. La richiesta è stata inoltrata al referente corretto.", appointment: (date, time) => `Ho creato la richiesta per ${date} alle ${time} e l’ho inviata per conferma.` },
    pt: { name: "Recebi sua solicitação. Pode informar seu nome completo?", phone: "Obrigado. Qual é o melhor telefone para contato?", date: "Qual dia funciona melhor para o agendamento?", time: "Qual horário você prefere?", clarify: "Pode explicar com um pouco mais de detalhes o que precisa?", greeting: "Olá, seja bem-vindo. Posso ajudar com agendamentos, preços ou suporte.", complete: "Já tenho todas as informações. Sua solicitação foi encaminhada ao responsável.", appointment: (date, time) => `Criei a solicitação para ${date} às ${time} e enviei para confirmação.` },
    nl: { name: "Ik heb uw verzoek ontvangen. Wat is uw volledige naam?", phone: "Dank u. Op welk telefoonnummer kunnen we u het beste bereiken?", date: "Welke dag komt het beste uit voor de afspraak?", time: "Welke tijd heeft uw voorkeur?", clarify: "Kunt u iets meer vertellen over wat u nodig hebt?", greeting: "Hallo en welkom. Ik kan helpen met afspraken, prijzen of support.", complete: "Ik heb alle benodigde gegevens. Uw verzoek is doorgestuurd naar de juiste medewerker.", appointment: (date, time) => `Uw verzoek voor ${date} om ${time} is aangemaakt en ter bevestiging verzonden.` },
    pl: { name: "Mam Twoje zgłoszenie. Proszę podać imię i nazwisko.", phone: "Dziękuję. Jaki jest najlepszy numer kontaktowy?", date: "Który dzień będzie najlepszy na wizytę?", time: "Którą godzinę wybierasz?", clarify: "Czy możesz dokładniej opisać, czego potrzebujesz?", greeting: "Dzień dobry. Mogę pomóc w sprawie wizyty, ceny lub wsparcia.", complete: "Mam wszystkie potrzebne dane. Zgłoszenie zostało przekazane odpowiedniej osobie.", appointment: (date, time) => `Utworzono zgłoszenie na ${date} o ${time} i wysłano je do potwierdzenia.` },
    ru: { name: "Я получил ваш запрос. Назовите, пожалуйста, имя и фамилию.", phone: "Спасибо. По какому номеру с вами лучше связаться?", date: "Какой день вам удобен для записи?", time: "Какое время вы предпочитаете?", clarify: "Расскажите, пожалуйста, подробнее, что вам нужно.", greeting: "Здравствуйте. Я помогу с записью, ценой или технической поддержкой.", complete: "Все необходимые данные получены. Запрос передан нужному специалисту.", appointment: (date, time) => `Запрос на ${date} в ${time} создан и отправлен на подтверждение.` },
  };
  const localized = replies[locale];
  if (state.completed) return state.intent === "randevu"
    ? localized.appointment(state.requestedDate, state.requestedTime)
    : localized.complete;
  const nextField = state.missingFields[0];
  if (nextField === "name") return localized.name;
  if (nextField === "phone") return localized.phone;
  if (nextField === "requestedDate") return localized.date;
  if (nextField === "requestedTime") return localized.time;
  const greetingPatterns: Record<Locale, RegExp> = {
    tr: /\b(merhaba|selam)\b/, en: /\b(hello|hi|hey)\b/, es: /\b(hola|buenas)\b/,
    de: /\b(hallo|guten\s+tag)\b/, fr: /\b(bonjour|salut)\b/, it: /\b(ciao|buongiorno)\b/,
    pt: /\b(olá|bom\s+dia)\b/, nl: /\b(hallo|goedendag)\b/, pl: /\b(cześć|dzień\s+dobry)\b/,
    ru: /\b(привет|здравствуйте)\b/,
  };
  if (greetingPatterns[locale].test(normalized)) return localized.greeting;
  if (history.length > 0) return localized.clarify;
  return localized.clarify;
}
