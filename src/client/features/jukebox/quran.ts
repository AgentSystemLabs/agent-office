/** The 114 surahs, played from Quran.com's own audio (Mishari Alafasy), in place of the lounge's synthesized tunes. */
export const SURAHS = [
  'Al-Fatihah', 'Al-Baqarah', 'Ali \u2018Imran', 'An-Nisa', 'Al-Ma\u2019idah', 'Al-An\u2019am', 'Al-A\u2019raf', 'Al-Anfal', 'At-Tawbah', 'Yunus',
  'Hud', 'Yusuf', 'Ar-Ra\u2019d', 'Ibrahim', 'Al-Hijr', 'An-Nahl', 'Al-Isra', 'Al-Kahf', 'Maryam', 'Ta-Ha',
  'Al-Anbiya', 'Al-Hajj', 'Al-Mu\u2019minun', 'An-Nur', 'Al-Furqan', 'Ash-Shu\u2019ara', 'An-Naml', 'Al-Qasas', 'Al-\u2018Ankabut', 'Ar-Rum',
  'Luqman', 'As-Sajdah', 'Al-Ahzab', 'Saba', 'Fatir', 'Ya-Sin', 'As-Saffat', 'Sad', 'Az-Zumar', 'Ghafir',
  'Fussilat', 'Ash-Shuraa', 'Az-Zukhruf', 'Ad-Dukhan', 'Al-Jathiyah', 'Al-Ahqaf', 'Muhammad', 'Al-Fath', 'Al-Hujurat', 'Qaf',
  'Adh-Dhariyat', 'At-Tur', 'An-Najm', 'Al-Qamar', 'Ar-Rahman', 'Al-Waqi\u2019ah', 'Al-Hadid', 'Al-Mujadila', 'Al-Hashr', 'Al-Mumtahanah',
  'As-Saf', 'Al-Jumu\u2019ah', 'Al-Munafiqun', 'At-Taghabun', 'At-Talaq', 'At-Tahrim', 'Al-Mulk', 'Al-Qalam', 'Al-Haqqah', 'Al-Ma\u2019arij',
  'Nuh', 'Al-Jinn', 'Al-Muzzammil', 'Al-Muddaththir', 'Al-Qiyamah', 'Al-Insan', 'Al-Mursalat', 'An-Naba', 'An-Nazi\u2019at', '\u2018Abasa',
  'At-Takwir', 'Al-Infitar', 'Al-Mutaffifin', 'Al-Inshiqaq', 'Al-Buruj', 'At-Tariq', 'Al-A\u2019la', 'Al-Ghashiyah', 'Al-Fajr', 'Al-Balad',
  'Ash-Shams', 'Al-Layl', 'Ad-Duhaa', 'Ash-Sharh', 'At-Tin', 'Al-\u2018Alaq', 'Al-Qadr', 'Al-Bayyinah', 'Az-Zalzalah', 'Al-\u2018Adiyat',
  'Al-Qari\u2019ah', 'At-Takathur', 'Al-\u2018Asr', 'Al-Humazah', 'Al-Fil', 'Quraysh', 'Al-Ma\u2019un', 'Al-Kawthar', 'Al-Kafirun', 'An-Nasr',
  'Al-Masad', 'Al-Ikhlas', 'Al-Falaq', 'An-Nas',
] as const;

export const QURAN_SITE = 'https://quran.com';

export const surahUrl = (n: number) => `https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/${n}.mp3`;

/** The surah number a stream link plays, or 0 if it isn't one of ours. */
export function surahOf(url: string | undefined): number {
  const m = /\/mishari_al_afasy\/murattal\/(\d+)\.mp3$/.exec(url ?? '');
  return m ? Number(m[1]) : 0;
}

/** A YouTube playlist of recitations, shown in the window (plays for you only). */
export const RECITATIONS = 'https://www.youtube.com/embed/videoseries?list=PLaPr5hj0xxM4OrOh0PXxj0nJ8spgyDwVO&rel=0';
