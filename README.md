# NVIDIA AI-1 Teardown

Sıvı soğutmalı bir masaüstü yapay zekâ bilgisayarının tarayıcıda çalışan, etkileşimli 3D söküm simülatörü. React ve three.js ile yazıldı; model tamamen kodla üretiliyor, dışarıdan hiçbir 3D dosya ya da doku yüklenmiyor.

![Çip incelemesi: ısı yayıcı kaldırılmış, detay paneli açık](docs/inspect-chip.png)

Açılışta 24 saniyelik bir söküm filmi oynar. Sahneye dokunduğunuz anda kontrol size geçer: kamerayı döndürebilir, parçalara tıklayıp yuvasından çıkarabilir ve her birinin özelliklerini canlı değerlerle inceleyebilirsiniz.

## Ekran görüntüleri

| Film modu | Patlatılmış görünüm |
| --- | --- |
| ![Film modu, makine çalışırken](docs/film.png) | ![Patlatılmış görünüm](docs/exploded.png) |

## Kurulum

Node.js 20.19 veya üstü gerekir.

```bash
npm install
npm run dev
```

Ardından terminalde yazan adresi açın (varsayılan `http://localhost:5173`).

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusunu başlatır |
| `npm run build` | Tip kontrolü yapar ve `dist/` klasörüne derler |
| `npm run preview` | Derlenmiş sürümü yerelde sunar |

## Kullanım

| Eylem | Sonuç |
| --- | --- |
| Sürükle | Kamerayı döndürür |
| Tekerlek | Yakınlaştırır / uzaklaştırır |
| Çift tıkla | Ana görünüme döner |
| Parçaya tıkla | Parçayı çıkarır, kamerayı ona odaklar ve detay panelini açar |
| Odaktaki parçaya tekrar tıkla | Parçayı yerine koyar |
| Boş alana tıkla | Odağı kaldırır |

Seçilebilen altı montaj grubu var: kapak, fanlar, soğutma sıvısı rezervuarı, radyatör, çip ve kablolar. Aynı anda birden fazlası dışarıda durabilir. İçerideki bir parça çıkarıldığında kapak ve fanlar yolu açmak için kendiliğinden kalkar.

Sağdaki **ASSEMBLIES** butonları ve **SUBSYSTEMS** satırları aynı parçaları açıp kapatır; **EXPLODED VIEW** tüm makineyi ayırır, **POWER ON** gücü açıp kapatır. Sahnenin altındaki **RESET VIEW**, **REASSEMBLE** ve **PLAY FILM** butonları görünümü sıfırlar, makineyi toplar ve filme geri döner. Zaman çizelgesine tıklayarak filmin istediğiniz anına gidebilirsiniz.

Soldaki göstergeler (fan devri, GPU sıcaklığı, çekirdek yükleri, güç tüketimi) makinenin o anki durumuna göre değişir. Değerler simülasyondur, gerçek bir ölçüme dayanmaz.

Filmi belirli bir saniyede duraklatılmış açmak için adrese `?t=` ekleyin, örneğin `http://localhost:5173/?t=14.6`.

## Nasıl çalışıyor

- **Tek zaman kaynağı.** Film modunda her şey `t` saniyesinin saf bir fonksiyonu: parça konumları, kamera, göstergeler ve arayüz metinleri `src/timeline.ts` içinden hesaplanır.
- **İki mod, yumuşak geçiş.** `film` modunu zaman çizelgesi, `inspect` modunu kullanıcı yönetir. İkisi her karede harmanlandığı için devralma sırasında kamera ya da parçalar sıçramaz.
- **Prosedürel model.** Gövde, fanlar, borular, radyatör ve anakart three.js temel geometrilerinden kurulur; petek desen, logo ve ışık haleleri `CanvasTexture` ile çizilir.
- **Etiketler.** 3D noktalara bağlı açıklamalar düz DOM öğeleridir ve her karede ekrana izdüşürülür.

```
src/
  timeline.ts        film sahneleri, parça kanalları, kamera yolu, gösterge değerleri
  store.ts           zustand durumu: mod, çıkarılan parçalar, odak
  live.ts            her karede güncellenen ortak değerler
  scene/
    Scene.tsx        Canvas, ışıklar, kamera sürücüsü, fare kontrolleri
    Machine.tsx      makinenin parçaları ve hareketleri
    materials.ts     malzemeler ve çizilen dokular
  hud/Hud.tsx        göstergeler, butonlar, detay paneli
  styles.css         arayüz stilleri
```

**Kullanılanlar:** Vite 8, React 19, TypeScript 7, three.js 0.187, @react-three/fiber 9, @react-three/drei 10, zustand 5.

## Notlar

- Tasarım, [bu videodaki](https://x.com/0x_fokki/status/2119817143927587090) konseptten esinlenen bağımsız bir çalışmadır.
- Resmî bir NVIDIA ürünü ya da projesi değildir ve NVIDIA ile bir bağlantısı yoktur. Makine kurgusaldır; logo elle çizilmiş stilize bir yorumdur.
