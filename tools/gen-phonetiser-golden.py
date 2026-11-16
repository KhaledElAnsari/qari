# Generates the golden file that pins the TypeScript arabic-phonetiser port to nipponjo's Python original.
# Run: python3 -I tools/gen-phonetiser-golden.py <path to tts_arabic/tts_arabic> > packages/qari-core/src/frontends/arabic-phonetiser/fixtures/phonetiser-golden.json
# Needs only the Python standard library (it imports tts_arabic's `text` package, not the models).
import json
import sys

sys.path.insert(0, sys.argv[1])
import text  # noqa: E402  (tts_arabic/text)

SENTENCES = [
    'اَلسَّلامُ عَلَيكُم يَا صَدِيقِي.',
    'قَالَ الرَّجُلُ لِصَاحِبِهِ: هَذَا كِتَابٌ جَمِيلٌ.',
    'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ',
    'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    'ذَهَبَ الطَّالِبُ إِلَى الْمَدْرَسَةِ صَبَاحًا.',
    'هَلْ قَرَأْتَ الْقُرْآنَ الْيَوْمَ؟',
    'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    'كَتَبُوا الدَّرْسَ ثُمَّ خَرَجُوا',
    'رَأَيْتُ مُعَلِّمًا فِي الشَّارِعِ',
    'سَأَلَ الْأَبُ ابْنَهُ عَنْ مُسْتَقْبَلِهِ',
    'الْمَاءُ بَارِدٌ وَالْهَوَاءُ مُنْعِشٌ!',
    'أُولَئِكَ هُمُ الْمُفْلِحُونَ',
    'لَكِنَّ الْحَقِيقَةَ مُخْتَلِفَةٌ',
    'ذَلِكَ الْكِتَابُ لَا رَيْبَ فِيهِ',
    'هَؤُلَاءِ طُلَّابٌ مُجْتَهِدُونَ',
    'مُسْتَشْفًى كَبِيرٌ فِي الْمَدِينَةِ',
    'صَلَّى الْمُسْلِمُونَ فِي الْمَسْجِدِ الْأَقْصَى',
    'قُوَّةٌ وَعِزَّةٌ وَكَرَامَةٌ',
    'الضَّوْءُ يَظْهَرُ فِي الظَّلَامِ',
    'شَاهَدْنَا فِيدْيُو فِي لَنْدَن',
    'سُئِلَ عَنْ مَسْؤُولِيَّتِهِ فَأَجَابَ',
    'آمَنَ بِاللَّهِ وَمَلَائِكَتِهِ',
    'رَمَى الْوَلَدُ الْكُرَةَ',
    'دَعَوْا رَبَّهُمْ خَوْفًا وَطَمَعًا',
    'الْقَاضِي عَادِلٌ',
    'جَاءَ زَيْدٌ ، وَذَهَبَ عَمْرٌو',
    'مَدِينَةٌ  جَمِيلَةٌ',
    'غَابَتِ الشَّمْسُ خَلْفَ الْجِبَالِ',
    'حَضَارَةُ السُّوبَرْمَارْكِت',
    'السلام عليكم ورحمة الله',
    'كتب الطالب الدرس',
    'هذا يوم جميل',
    'ـــ',
    'مُحَمَّدٌ - رَسُولُ اللَّهِ',
    'ضَرَبَ ضَرْبًا شَدِيدًا',
    'الطَّقْسُ حَارٌّ جِدًّا',
    'تُوُفِّيَ فِي عَامِ أَلْفٍ وَتِسْعِمِئَةٍ وَثَمَانِيَةٍ وَأَرْبَعِينَ.',
    'يَا أَيُّهَا النَّاسُ',
    'ٱلْكِتَابُ',
    'سَيَّارَةٌ جَدِيدَةٌ?',
]

cases = []
for sentence in SENTENCES:
    buckwalter = text.arabic_to_buckwalter(sentence)
    phonemes = text.buckwalter_to_phonemes(buckwalter)
    tokens = text.phonemes_to_tokens(phonemes)
    ids = [text.phon_to_id.get(token, -1) for token in tokens]
    cases.append({'text': sentence, 'buckwalter': buckwalter, 'phonemes': phonemes, 'tokens': tokens, 'ids': ids})

json.dump({'source': 'nipponjo/tts_arabic text/ (Python)', 'cases': cases}, sys.stdout, ensure_ascii=False, indent=1)
sys.stdout.write('\n')
