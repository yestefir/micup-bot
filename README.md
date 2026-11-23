<div align="center">

<img src="https://cdn.yestefir.com/project/micup/bot/banner.png" alt="micup-bot" width="100%">

# micup-bot

**Micup için seviye sistemi, moderasyon ve sunucu yönetimi botu.**

XP/seviye, rank kartı, liderlik tablosu, ban · mute · purge, ayar paneli, otomatik rol ve sunucu etiketi — hepsi tek botta. [`micup.ts`](https://www.npmjs.com/package/micup.ts) ile yazıldı, 6 dili destekler.

![License](https://img.shields.io/badge/license-MIT-blue) ![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white) ![Micup](https://img.shields.io/badge/platform-Micup-black)

</div>

---

## Özellikler

### Seviye sistemi

Üyeler yazdıkça XP kazanır, seviye atlar. Kartlar `@napi-rs/canvas` ile çizilir; avatar, ilerleme çubuğu ve sıralama otomatik hesaplanır.

<img src="https://cdn.yestefir.com/project/micup/bot/rank.png" alt="Rank kartı" width="720">

Seviye atlayınca kart ya yazılan kanala ya da ayarladığın duyuru kanalına gönderilir:

<img src="https://cdn.yestefir.com/project/micup/bot/levelup.png" alt="Seviye atlama kartı" width="576">

- Mesaj başına rastgele XP (varsayılan 15–25) ve bekleme süresi (varsayılan 60 sn)
- Seviye başına gereken XP: `5·n² + 50·n + 100`
- Seviye atlama duyurusunu kanalda göster, ayrı kanala yönlendir ya da kapat

### Liderlik tablosu

Sayfalı, avatarlı sıralama kartı.

<img src="https://cdn.yestefir.com/project/micup/bot/leaderboard.png" alt="Liderlik tablosu" width="576">

### Moderasyon

`ban`, `mute` ve `sil` komutları; rol hiyerarşisi kontrolü, yetki denetimi ve süreli onay oturumlarıyla çalışır. Yanlışlıkla işlem yapmayı zorlaştırır.

### Ayar paneli

`/ayarlar` ile sunucu başına etkileşimli panel: prefix, dil, XP aralığı, bekleme süresi, duyuru kanalı, moderasyon oturum süreleri ve roller buradan değişir.

### Otomatik rol

Sunucuya katılan üyelere seçtiğin roller otomatik verilir (botlara verilmez, en fazla 10 rol).

### Sunucu etiketi (Guild Tag)

Etiketi takan üyelere rol verir, çıkarınca roller geri alınabilir ve log kanalına bildirim düşer. Sunucuda etiket aktif değilse bu ayarlar kilitli kalır.

### Slash + prefix komutları

Her komut hem `/komut` hem de `!komut` olarak çalışır. Prefix sunucu başına değiştirilebilir.

### Çoklu dil

Türkçe, İngilizce (`en-US`), Almanca, İspanyolca (`es-ES`), Fransızca ve Rusça. Dil sunucu başına seçilir.

---

## Komutlar

| Komut | Takma adlar | Açıklama | Yetki |
| --- | --- | --- | --- |
| `seviye [kullanıcı]` | `rank`, `level`, `xp` | Seviye ve XP durumunu gösterir | — |
| `liderlik [sayfa]` | `top`, `leaderboard`, `siralama` | Sunucu sıralamasını gösterir | — |
| `ayarlar` | `ayar` | Ayar panelini açar | Sunucuyu Yönet |
| `mute <kullanıcı>` | `sustur`, `sus` | Kullanıcıyı süreli susturur | Üyeleri Zaman Aşımına Uğrat |
| `ban <kullanıcı>` | `yasakla` | Kullanıcıyı yasaklar | Üyeleri Yasakla |
| `sil <miktar> [kullanıcı]` | `temizle`, `clear` | Son mesajları siler | Mesajları Yönet |

> Komut adları dile göre değişir (örn. İngilizcede `purge`). Yukarıdakiler Türkçe adlardır.

---

## Kurulum

Node.js 24 veya üzeri ve bir Micup bot tokenı gerekir (`micup.ts` SDK'sının şartı).

```bash
git clone https://github.com/yestefir/micup-bot.git
cd micup-bot
npm install
cp .env.example .env
```

`.env` dosyasını doldur:

| Değişken | Açıklama |
| --- | --- |
| `MICUP_BOT_TOKEN` | Bot tokenı |
| `MICUP_GUILD_ID` | Komutların kaydedileceği sunucu ID'si |
| `DEFAULT_PREFIX` | Varsayılan prefix (`!`) |
| `DEFAULT_LANGUAGE` | Varsayılan dil kodu (`tr`) |

```bash
npm start        # botu başlat
npm run dev      # dosya değişince yeniden başlat
npm test         # testleri çalıştır
```

Veriler `db/` klasöründe (`settings.db`, `levels.db`, `guildtag.db`) tutulur.

---

## Proje yapısı

```
src/
├── commands/     slash ve prefix komutları (admin / member)
├── core/         olay, etkileşim, i18n, ayar ve seviye çekirdeği
├── events/       clientready, messagecreate, autorole, guildtag, XP
├── locales/      tr, en-US, de, es-ES, fr, ru
├── utils/        kart çizimi, moderasyon, ayar paneli, yardımcılar
└── config/       kart renkleri, panel ve moderasyon ayarları
test/             node:test ile yazılmış testler
```

## Lisans

[MIT](LICENSE)
