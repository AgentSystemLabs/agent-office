/** The 114 surahs, played from Quran.com's own audio (Mishari Alafasy), in place of the lounge's synthesized tunes. */
export const SURAHS = [
  'Al-Fatihah',
  'Al-Baqarah',
  'Ali \u2018Imran',
  'An-Nisa',
  'Al-Ma\u2019idah',
  'Al-An\u2019am',
  'Al-A\u2019raf',
  'Al-Anfal',
  'At-Tawbah',
  'Yunus',
  'Hud',
  'Yusuf',
  'Ar-Ra\u2019d',
  'Ibrahim',
  'Al-Hijr',
  'An-Nahl',
  'Al-Isra',
  'Al-Kahf',
  'Maryam',
  'Ta-Ha',
  'Al-Anbiya',
  'Al-Hajj',
  'Al-Mu\u2019minun',
  'An-Nur',
  'Al-Furqan',
  'Ash-Shu\u2019ara',
  'An-Naml',
  'Al-Qasas',
  'Al-\u2018Ankabut',
  'Ar-Rum',
  'Luqman',
  'As-Sajdah',
  'Al-Ahzab',
  'Saba',
  'Fatir',
  'Ya-Sin',
  'As-Saffat',
  'Sad',
  'Az-Zumar',
  'Ghafir',
  'Fussilat',
  'Ash-Shuraa',
  'Az-Zukhruf',
  'Ad-Dukhan',
  'Al-Jathiyah',
  'Al-Ahqaf',
  'Muhammad',
  'Al-Fath',
  'Al-Hujurat',
  'Qaf',
  'Adh-Dhariyat',
  'At-Tur',
  'An-Najm',
  'Al-Qamar',
  'Ar-Rahman',
  'Al-Waqi\u2019ah',
  'Al-Hadid',
  'Al-Mujadila',
  'Al-Hashr',
  'Al-Mumtahanah',
  'As-Saf',
  'Al-Jumu\u2019ah',
  'Al-Munafiqun',
  'At-Taghabun',
  'At-Talaq',
  'At-Tahrim',
  'Al-Mulk',
  'Al-Qalam',
  'Al-Haqqah',
  'Al-Ma\u2019arij',
  'Nuh',
  'Al-Jinn',
  'Al-Muzzammil',
  'Al-Muddaththir',
  'Al-Qiyamah',
  'Al-Insan',
  'Al-Mursalat',
  'An-Naba',
  'An-Nazi\u2019at',
  '\u2018Abasa',
  'At-Takwir',
  'Al-Infitar',
  'Al-Mutaffifin',
  'Al-Inshiqaq',
  'Al-Buruj',
  'At-Tariq',
  'Al-A\u2019la',
  'Al-Ghashiyah',
  'Al-Fajr',
  'Al-Balad',
  'Ash-Shams',
  'Al-Layl',
  'Ad-Duhaa',
  'Ash-Sharh',
  'At-Tin',
  'Al-\u2018Alaq',
  'Al-Qadr',
  'Al-Bayyinah',
  'Az-Zalzalah',
  'Al-\u2018Adiyat',
  'Al-Qari\u2019ah',
  'At-Takathur',
  'Al-\u2018Asr',
  'Al-Humazah',
  'Al-Fil',
  'Quraysh',
  'Al-Ma\u2019un',
  'Al-Kawthar',
  'Al-Kafirun',
  'An-Nasr',
  'Al-Masad',
  'Al-Ikhlas',
  'Al-Falaq',
  'An-Nas',
] as const;

export const QURAN_SITE = 'https://quran.com';

export const surahUrl = (n: number) => `https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/${n}.mp3`;

/** The surah number a stream link plays, or 0 if it isn't one of ours. */
export function surahOf(url: string | undefined): number {
  const m = /\/mishari_al_afasy\/murattal\/(\d+)\.mp3$/.exec(url ?? '');
  return m ? Number(m[1]) : 0;
}

/** The recitation videos in the YouTube playlist, each its own video. */
export const RECITATION_VIDEOS: readonly { id: string; title: string }[] = [
  {
    id: '9LI4nGxSHxc',
    title: 'سورة آل عمران  بجامع أم الخير بجدة  - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'xi6dw72oTCg',
    title: 'سورة النساء بجامع أم الخير بجدة  - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'msit8KG4RJI',
    title: 'سورة المائدة بجامع أم الخير بجدة  - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'qo_JfaxVzCc',
    title: 'سورة الأنعام بجامع أم الخير بجدة  - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'eSkkdb3D8Bg',
    title: 'سورة الأعراف بجامع أم الخير بجدة - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '-VLGmdribh0',
    title: 'سورة الأنفال بجامع أم الخير بجدة  - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'ToMXxynN5pU',
    title: 'سورة الرعد بجامع الأمير محمد بن سعود ببلجرشي - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'T_gCH8m5RXs',
    title: 'سورة إبراهيم بجامع الأمير محمد بن سعود ببلحرشي - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'BoTcKimRC3w',
    title: 'سورة الحجر بجامع الأمير محمد بن سعود ببلجرشي - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'BXKYezGxp5o',
    title: 'سورة طه بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'DQesAqKd0Nc',
    title: 'سورة المؤمنون بجامع أجور بالبحرين - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '9HM6Q1oHb9c',
    title: 'سورة النور بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'vRPFztyqXJs',
    title: 'سورة الفرقان بمسجد معاوية بن أبي سفيان بالبحرين - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'p_O3DI5QDxw',
    title: 'سورة الشعراء بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'iZSOwZvXYcc',
    title: 'سورة النمل بمسجد حمزة بن عبد المطلب  بالبحرين - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'yL6Re8gYzPQ',
    title: 'سورة القصص بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'Qh0ZAJTlBuA',
    title: 'سورة العنكبوت بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'F2B_M0mKQ-0',
    title: 'سورة الروم بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '50UctEL97Gk',
    title: 'سورة الأحزاب بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'dhXF6ExbqEM',
    title: 'سورة سبأ بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '5ABndDmOx2w',
    title: 'سورة فاطر بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'WsBmnWd3Dcs',
    title: 'سورة الصافات بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'BrAgW4v3-dM',
    title: 'سورة فصلت بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'ncgDaPUdCt0',
    title: 'سورة الزخرف بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'VXhHf5odZho',
    title: 'سورة الأحقاف بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'adIhq7PYrsk',
    title: 'سورة الطور بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'BvmNFoHQSks',
    title: 'سورة الممتحنة بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '0eKdeOCOw4I',
    title: 'سورة الطلاق بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'UlcGsR10mWQ',
    title: 'سورة التحريم بمسجد المحمدية الغربية بالرياض - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'X-W0Y57p3Z0',
    title: 'أدعية القنوت (1) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'IVn-bh0eOgs',
    title: 'أدعية القنوت (2) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'h1Jy0b7sO2U',
    title: 'أدعية القنوت (3) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'otoUAuzuJzE',
    title: 'أدعية القنوت (4) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'UN-Okb0aPU0',
    title: 'أدعية القنوت (5) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'L5ZsyyY52u4',
    title: 'أدعية القنوت (6) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '_B6ulcpb30M',
    title: 'أدعية القنوت (7) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '4VU3i4pWQIo',
    title: 'أدعية القنوت (8) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'ALFn_adnnrY',
    title: 'أدعية القنوت (9) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'bYAefO9uBeE',
    title: 'أدعية القنوت (10) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'pRE8SYzUtfk',
    title: 'أدعية القنوت (11) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '54MsG1-XWEY',
    title: 'أدعية القنوت (12) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '4CZSnZf9NAM',
    title: 'أدعية القنوت (13) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '0FqBPqr1fPY',
    title: 'أدعية القنوت (14) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'C8-Zavu3jwE',
    title: 'أدعية القنوت (15) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '4YfkOAIFq3Y',
    title: 'أدعية القنوت (16) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'FtwDElLlUs0',
    title: 'أدعية القنوت (17) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'MjApag6140g',
    title: 'أدعية القنوت (18) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: 'j2L9hEgO5pM',
    title: 'أدعية القنوت (19) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
  {
    id: '8GQb9xiwmzM',
    title: 'أدعية القنوت (20) - رمضان 1438 هـ للقارئ الشيخ أحمد ديبان',
  },
];

/** A video's short name: the surah, without the mosque, year and reciter that every title repeats. */
export const videoName = (title: string) => title.split(' بجامع')[0].trim() || title;
