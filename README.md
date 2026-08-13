# Arama — Multilingual Voice Agent

10 dil destekli düşük gecikmeli çağrı elemanı prototipi. Tarayıcıdan mikrofon
kaydı alır, OpenAI veya Fish Audio ile seçilen dilde yazıya çevirir, Claude ya
da OpenAI ile cevabı üretir ve Fish Audio ile konuşur. API anahtarları yokken
yerleşik demo motoru sayesinde arayüz, yapılandırılmış çağrı kaydı ve senaryo
akışı çalışmaya devam eder.

Desteklenen diller: İngilizce, Türkçe, İspanyolca, Almanca, Fransızca,
İtalyanca, Portekizce, Felemenkçe, Lehçe ve Rusça. Dil görüşme sırasında
arayüzden seçilir; seçim transkripsiyon, niyet çıkarımı, model talimatı, ses
sentezi, yerel demo ve indirilen özete birlikte uygulanır.

## Kurulum

```bash
npm install
cp .env.example .env
npm run dev
```

`http://localhost:5177` adresini açın.

Sunum için doğrudan `http://localhost:5177/#/present` adresini açın. Bu görünüm;
üç tek tık senaryo, büyük ilk-ses ölçümü, sadeleştirilmiş servis durumu ve canlı
servis kesilirse otomatik yerel sesli yedek içerir. API anahtarları, bakiye ve ham
servis hataları sunum ekranında gösterilmez.

## Bağlantılar

- `ANTHROPIC_API_KEY`: Claude ile cevap üretimi
- `ANTHROPIC_MODEL`: Claude modeli (varsayılan: `claude-haiku-4-5-20251001`)
- `OPENAI_API_KEY`: isteğe bağlı OpenAI transkripsiyonu ve Claude yoksa cevap üretimi
- `FISH_AUDIO_API_KEY`: Fish Audio TTS
- `FISH_AUDIO_REFERENCE_ID`: kullanılacak/klonlanmış Fish sesi
- `FISH_AUDIO_REFERENCE_ID_EN`, `_TR`, `_ES`, `_DE`, `_FR`, `_IT`, `_PT`,
  `_NL`, `_PL`, `_RU`: dile özel ses kimlikleri; tanımsızsa ortak ses kullanılır
- `AGENT_LANG`: API/telefon isteği dil belirtmezse varsayılan dil (`en`)
- `DEMO_MODE=false`: gerçek bağlantıları zorunlu kılar

API anahtarları yalnızca Express sunucusunda tutulur; tarayıcıya gönderilmez.

## Akış

1. Düğmeye basıp konuş, kaydı bitirerek gönder veya metin yaz.
2. İstemci seçilen dili `locale` alanıyla API'ye taşır; `/api/turn` ses dosyasını
   aynı dil koduyla OpenAI veya Fish Audio transcription servisine gönderir.
3. `/api/turn/stream`, görüşme niyetine uygun kısa girişi anında başlatır.
4. Claude Messages API cevabı SSE parçaları hâlinde üretirken Fish Audio'nun
   resmî JavaScript SDK'sı metni WebSocket TTS akışına besler.
5. Fish MP3 parçalarını üretildikçe tarayıcıya yollar; MediaSource oynatımı tüm
   dosyayı beklemeden başlar. Fish anahtarı yoksa sistem konuşma sentezi kullanılır.

Bu sürüm bas-konuş mantığında düşük gecikmeli Claude + Fish WebSocket TTS
streaming kullanır. Tarayıcı sessizliği algılayıp kaydı otomatik gönderir; kullanıcı
yanıt sürerken mikrofona basarak oynatmayı ve devam eden API isteğini kesebilir.

## Production özellikleri

- `npm start` ile çalışan tek production paketi; Node 22 hedefi ve Dockerfile
- İstek/sağlık loglarında kişisel veri taşımayan yapılandırılmış JSON kayıtları
- Genel API ve görüşme endpointleri için IP tabanlı hız sınırı
- Aynı-origin koruması, güvenlik başlıkları ve ses dosyası boyut/tür sınırı
- Tamamlanan lead/randevular için kalıcı JSONL kayıt ve isteğe bağlı AES-256-GCM şifreleme
- Yetkili kayıt listeleme/silme endpointleri ve varsayılan 30 günlük saklama süresi
- CRM ve takvim için bağımsız webhook adaptörleri
- Twilio gelen arama webhooku, locale uyumlu speech gather ve Fish Audio MP3 `<Play>` yanıtı
- İstemciden sunucuya taşınan iptal sinyali, sessizlik algılama ve açık rıza kontrolü
- Node test runner testleri, GitHub Actions CI ve production HTTP smoke testi

Production ortamında `DATA_ENCRYPTION_KEY`, `ADMIN_API_KEY` ve kullanılacak servis
anahtarlarını zorunlu secret olarak tanımlayın. Ayrıntılar için `PRIVACY.md` dosyasına bakın.

## Telefon hattı

1. Uygulamayı HTTPS ile dışarı açın ve `PUBLIC_BASE_URL` değerini yazın.
2. Twilio numarasının gelen arama webhookunu `POST /api/telephony/incoming` yapın.
   Hat dilini URL'de örneğin `?locale=tr`, `?locale=de` veya `?locale=fr` ile seçin.
3. `TWILIO_AUTH_TOKEN` değerini secret olarak ekleyin.
4. Fish anahtarı ve public URL varsa yanıt MP3 olarak üretilip Twilio `<Play>` ile çalınır;
   Fish yoksa Twilio seçilen locale ile `<Say>` yedeğini kullanır.

Webhook imzası production ortamında zorunludur. Telefon adaptörü Twilio'nun `CallSid`
değeriyle görüşme durumunu tutar ve tamamlanan talebi normal kayıt/CRM akışına gönderir.

## Doğrulama

```bash
npm run check
npm test
npm run build
```

Test paketi on dilde randevu niyeti, göreli tarih ve saat çıkarımını; ayrıca
uluslararası telefon/isim tamamlama, şifreli kayıt ve Twilio locale üretimini kapsar.

Production sunucusu ayrı bir terminalde çalışırken uçtan uca yerel kontrol:

```bash
SMOKE_BASE_URL=http://127.0.0.1:5193 npm run smoke:http
```

Canlılık: `GET /api/health/live`  
Hazırlık: `GET /api/health/ready`
