# LinkedIn paylaşım taslağı

## Türkçe

**VoiceOps Studio’yu bir sesli AI demosundan, müşteriye özel kurulabilen yönetilen bir ürüne dönüştürdüm.**

Sistem; müşterinin konuşmasını yalnızca metne çevirmiyor. Randevu, fiyat ve destek taleplerini yapılandırılmış iş akışına dönüştürüyor, eksik bilgileri topluyor, yanıtı canlı seslendiriyor ve kullanım maliyetini sunucu tarafında ölçüyor.

Son sürümde:

- 10 dilde tarayıcı ve telefon akışı
- Fish Audio S2 Pro ile canlı ses üretimi
- Claude/OpenAI desteği ve servis kesintisinde deterministik yerel yedek
- streaming ses, sessizlik algılama ve söz kesme
- müşteri bazlı beyaz etiket: marka, ajan, işletme ve paket yapılandırması
- aktif ses saniyesi ölçümü, aylık kullanım raporu ve sert maliyet kotası
- bilgilendirmeden ayrı kayıt izni, AES-256-GCM şifreleme ve süreli saklama
- korumalı operasyon paneli: dakika, görüşme, paket aşımı ve izinli lead kayıtları
- doğrulanmış Twilio webhook akışı, CRM/takvim aktarımı
- 23 otomatik test, production build ve 13 kontrollü HTTP/telefon smoke adımı

Benim için asıl mühendislik konusu yalnız “AI konuşuyor” değildi; sağlayıcı kapandığında ne olduğu, maliyetin nasıl sınırlandığı, verinin hangi izinle kaydedildiği ve müşterinin kullanımının nasıl faturalandırılabildiğiydi.

Canlı demo: https://voiceops-studio-production.up.railway.app/#/present

Kaynak kod ve teknik kanıt: https://github.com/moriana55/voiceops-studio

#VoiceAI #AIEngineering #TypeScript #React #NodeJS #SaaS #OpenSource

## English

**I turned VoiceOps Studio from a multilingual voice demo into a productized, customer-configurable managed MVP.**

It converts appointment, pricing, and support conversations into structured workflows, asks for missing details, streams the reply in a selected voice, and meters active voice usage on the server.

The current release includes ten-language browser and telephone flows, Fish Audio S2 Pro speech, optional Claude/OpenAI intelligence, deterministic provider fallback, white-label customer configuration, monthly hard cost limits, a protected usage/lead dashboard, separately consented encrypted records, and verified Twilio/CRM boundaries.

The repository now passes 23 automated tests, a production build, and a 13-step HTTP/telephone smoke flow.

The interesting engineering work was not only making the agent speak. It was defining what happens when a provider fails, how usage becomes billable, how cost is capped, and when customer data may be stored.

Live demo: https://voiceops-studio-production.up.railway.app/#/present

Repository: https://github.com/moriana55/voiceops-studio

#VoiceAI #AIEngineering #TypeScript #React #NodeJS #SaaS #OpenSource

## Önerilen medya

1. İlk görsel: güncel masaüstü canlı konsolu.
2. İkinci görsel: `/#/admin` ekranında sahte test verisiyle kullanım kartları; gerçek `ADMIN_API_KEY` görünmemeli.
3. 25–35 saniyelik video: Türkçe randevu senaryosu → izinli çağrı kaydı → yönetim panelinde kullanım artışı → İngilizceye geçiş.
4. İlk yorumda ürünleştirme kararı: “Per-turn rounding yerine aylık active-voice-seconds toplamı kullanıyorum.”

Fish Audio partner/sponsor gibi anlatılmamalı. Güvenli ifade: “live speech synthesis with Fish Audio S2 Pro.”
