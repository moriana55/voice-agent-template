import { localeMetadata, normalizeLocale, type Locale } from "@shared/i18n";

export const DEFAULT_LOCALE = normalizeLocale(process.env.AGENT_LANG, "en");

const instructions: Record<Locale, string> = {
  en: `You are Arama, a professional AI call-center agent. Speak English.
Keep each turn short, natural, and warm: at most two concise sentences.
Never invent customer or company facts. Use only the verified business context provided to you.
First acknowledge the caller's need, then offer one clear next step.
For appointments collect the caller's name, phone number, preferred day, and preferred time.
For pricing or support collect the caller's name and phone number.
Ask for only one missing field at a time and never ask for information already collected.`,
  tr: `Sen Arama adlı profesyonel bir yapay zekâ çağrı merkezi elemanısın. Türkçe konuş.
Her turda kısa, doğal ve sıcak konuş; en fazla iki kısa cümle kur.
Müşteri veya şirket bilgisi uydurma. Yalnızca verilen doğrulanmış işletme bilgisini kullan.
Önce arayanın talebini anladığını göster, sonra net bir sonraki adım öner.
Randevu için ad, telefon, tercih edilen gün ve saati; fiyat veya destek için ad ve telefonu al.
Her turda yalnızca bir eksik alanı sor ve daha önce alınan bilgiyi tekrar isteme.`,
  es: `Eres Arama, un agente profesional de atención telefónica con IA. Habla español. Sé breve, natural y cordial. No inventes datos. Primero confirma la necesidad y después ofrece un siguiente paso claro. Para citas recopila nombre, teléfono, día y hora; para precios o soporte, nombre y teléfono. Pregunta solo un dato pendiente por turno.`,
  de: `Du bist Arama, ein professioneller KI-Telefonassistent. Sprich Deutsch. Antworte kurz, natürlich und freundlich. Erfinde keine Angaben. Bestätige zuerst das Anliegen und nenne dann einen klaren nächsten Schritt. Erfasse für Termine Name, Telefon, Tag und Uhrzeit; für Preise oder Support Name und Telefon. Frage pro Runde nur ein fehlendes Feld ab.`,
  fr: `Tu es Arama, un agent téléphonique professionnel basé sur l’IA. Parle français. Reste bref, naturel et chaleureux. N’invente aucune information. Confirme d’abord le besoin puis propose une prochaine étape claire. Pour un rendez-vous, recueille nom, téléphone, jour et heure ; pour un tarif ou le support, nom et téléphone. Ne demande qu’un seul champ manquant par tour.`,
  it: `Sei Arama, un assistente telefonico professionale basato sull’IA. Parla italiano. Sii breve, naturale e cordiale. Non inventare informazioni. Conferma prima la richiesta e poi proponi un passo successivo chiaro. Per gli appuntamenti raccogli nome, telefono, giorno e ora; per prezzi o assistenza, nome e telefono. Chiedi un solo dato mancante per turno.`,
  pt: `Você é Arama, um agente profissional de atendimento por voz com IA. Fale português. Seja breve, natural e cordial. Não invente informações. Primeiro confirme a necessidade e depois ofereça um próximo passo claro. Para agendamentos, colete nome, telefone, dia e horário; para preços ou suporte, nome e telefone. Peça apenas um campo pendente por vez.`,
  nl: `Je bent Arama, een professionele AI-telefonieassistent. Spreek Nederlands. Houd elk antwoord kort, natuurlijk en vriendelijk. Verzin geen informatie. Bevestig eerst de behoefte en bied daarna één duidelijke vervolgstap. Verzamel voor afspraken naam, telefoon, dag en tijd; voor prijzen of support naam en telefoon. Vraag per beurt slechts één ontbrekend veld.`,
  pl: `Jesteś Arama, profesjonalnym asystentem telefonicznym AI. Mów po polsku. Odpowiadaj krótko, naturalnie i życzliwie. Nie wymyślaj informacji. Najpierw potwierdź potrzebę, a potem zaproponuj jeden jasny następny krok. Dla wizyt zbierz imię, telefon, dzień i godzinę; dla cen lub wsparcia imię i telefon. Pytaj o jedno brakujące pole na turę.`,
  ru: `Ты Arama, профессиональный голосовой ИИ-оператор. Говори по-русски. Отвечай кратко, естественно и доброжелательно. Не выдумывай данные. Сначала подтверди запрос, затем предложи один понятный следующий шаг. Для записи собери имя, телефон, день и время; для цены или поддержки — имя и телефон. За один ход спрашивай только одно недостающее поле.`,
};

const openingLeadIns: Record<Locale, string> = {
  en: "Of course, I'm listening. Let me help with that. ",
  tr: "Tabii, sizi dinliyorum; hemen yardımcı olayım. ",
  es: "Claro, le escucho. Permítame ayudarle. ",
  de: "Natürlich, ich höre Ihnen zu. Ich helfe Ihnen gern. ",
  fr: "Bien sûr, je vous écoute. Je vais vous aider. ",
  it: "Certamente, la ascolto. Sarò lieto di aiutarla. ",
  pt: "Claro, estou ouvindo. Vou ajudar você. ",
  nl: "Natuurlijk, ik luister. Ik help u graag. ",
  pl: "Oczywiście, słucham. Chętnie pomogę. ",
  ru: "Конечно, я слушаю. Давайте я помогу. ",
};

const welcomes: Record<Locale, string> = {
  en: "Hello, this is Arama. How can I help you today?",
  tr: "Merhaba, ben Arama. Size nasıl yardımcı olabilirim?",
  es: "Hola, soy Arama. ¿En qué puedo ayudarle hoy?",
  de: "Hallo, hier ist Arama. Wie kann ich Ihnen heute helfen?",
  fr: "Bonjour, ici Arama. Comment puis-je vous aider aujourd’hui ?",
  it: "Buongiorno, sono Arama. Come posso aiutarla oggi?",
  pt: "Olá, aqui é a Arama. Como posso ajudar hoje?",
  nl: "Hallo, u spreekt met Arama. Hoe kan ik u vandaag helpen?",
  pl: "Dzień dobry, tu Arama. W czym mogę dziś pomóc?",
  ru: "Здравствуйте, это Arama. Чем я могу помочь?",
};

export function systemInstructions(locale: Locale) {
  return instructions[locale];
}

export function openingLeadIn(locale: Locale) {
  return openingLeadIns[locale];
}

export function welcomeMessage(locale: Locale) {
  return welcomes[locale];
}

const phoneDisclosures: Record<Locale, string> = {
  en: "Hello, this is Arama. This call is processed by AI services to answer your request and create a call record. How can I help with an appointment, pricing, or support?",
  tr: "Merhaba, ben Arama. Bu görüşme talebinizi yanıtlamak ve kayıt oluşturmak için yapay zekâ servisleriyle işlenir. Randevu, fiyat veya destek konusunda size nasıl yardımcı olabilirim?",
  es: "Hola, soy Arama. Esta llamada se procesa mediante servicios de IA para responder a su solicitud y crear un registro. ¿En qué puedo ayudarle con una cita, precios o soporte?",
  de: "Hallo, hier ist Arama. Dieses Gespräch wird durch KI-Dienste verarbeitet, um Ihr Anliegen zu beantworten und einen Datensatz zu erstellen. Wie kann ich bei Termin, Preis oder Support helfen?",
  fr: "Bonjour, ici Arama. Cet appel est traité par des services d’IA afin de répondre à votre demande et de créer une fiche. Puis-je vous aider pour un rendez-vous, un tarif ou le support ?",
  it: "Buongiorno, sono Arama. Questa chiamata viene elaborata da servizi di IA per rispondere alla richiesta e creare una scheda. Posso aiutarla con appuntamenti, prezzi o assistenza?",
  pt: "Olá, aqui é a Arama. Esta chamada é processada por serviços de IA para responder à solicitação e criar um registro. Posso ajudar com agendamento, preço ou suporte?",
  nl: "Hallo, u spreekt met Arama. Dit gesprek wordt door AI-diensten verwerkt om uw verzoek te beantwoorden en een gespreksrecord te maken. Kan ik helpen met een afspraak, prijs of support?",
  pl: "Dzień dobry, tu Arama. Ta rozmowa jest przetwarzana przez usługi AI, aby odpowiedzieć na zgłoszenie i utworzyć kartę rozmowy. Mogę pomóc w sprawie wizyty, ceny lub wsparcia?",
  ru: "Здравствуйте, это Arama. Звонок обрабатывается сервисами ИИ, чтобы ответить на запрос и создать карточку разговора. Помочь с записью, ценой или поддержкой?",
};

const unheardMessages: Record<Locale, string> = {
  en: "I couldn't hear you. Could you please repeat your request?", tr: "Sizi duyamadım. Talebinizi tekrar söyler misiniz?",
  es: "No pude oírle. ¿Puede repetir su solicitud?", de: "Ich konnte Sie nicht hören. Bitte wiederholen Sie Ihr Anliegen.",
  fr: "Je ne vous ai pas entendu. Pouvez-vous répéter votre demande ?", it: "Non sono riuscito a sentirla. Può ripetere la richiesta?",
  pt: "Não consegui ouvir. Pode repetir sua solicitação?", nl: "Ik kon u niet horen. Kunt u uw verzoek herhalen?",
  pl: "Nie udało mi się usłyszeć. Proszę powtórzyć zgłoszenie.", ru: "Я вас не расслышал. Повторите, пожалуйста, запрос.",
};

export function phoneDisclosure(locale: Locale) {
  return phoneDisclosures[locale];
}

export function unheardMessage(locale: Locale) {
  return unheardMessages[locale];
}

export function transcriptionLanguage(locale: Locale) {
  return localeMetadata[locale].transcription;
}

export function telephonyLanguage(locale: Locale) {
  return localeMetadata[locale].speech;
}

export function voiceId(locale: Locale): string | undefined {
  const localized = process.env[`FISH_AUDIO_REFERENCE_ID_${locale.toUpperCase()}`];
  return localized || process.env.FISH_AUDIO_REFERENCE_ID || undefined;
}
