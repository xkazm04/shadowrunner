"""Phoneme -> viseme map and span building; runs without the model (python -m unittest)."""

import unittest

from lab_voice.visemes import MODIFIERS, PHONEME_VISEME, VISEMES, Span, spans, uniform, viseme_of


class PhonemeMap(unittest.TestCase):
    def test_every_target_is_an_oculus_viseme(self) -> None:
        self.assertEqual(len(VISEMES), 15)
        self.assertTrue(set(PHONEME_VISEME.values()) <= set(VISEMES))
        self.assertEqual(set(PHONEME_VISEME.values()), set(VISEMES) - {"sil"})

    def test_representative_phonemes(self) -> None:
        cases = {"p": "PP", "b": "PP", "m": "PP", "f": "FF", "v": "FF", "θ": "TH", "ð": "TH",
                 "t": "DD", "d": "DD", "k": "kk", "ŋ": "kk", "ʃ": "CH", "ʒ": "CH", "s": "SS",
                 "z": "SS", "n": "nn", "l": "nn", "ɹ": "RR", "ɚ": "RR", "æ": "aa", "ɑ": "aa",
                 "ɛ": "E", "ə": "E", "ɪ": "ih", "i": "ih", "ɔ": "oh", "o": "oh", "ʊ": "ou",
                 "u": "ou", "w": "ou"}
        for phoneme, v in cases.items():
            self.assertEqual(viseme_of(phoneme), v, phoneme)

    def test_gaps_rest_and_unknowns_rest(self) -> None:
        for ch in " .,!?":
            self.assertEqual(viseme_of(ch), "sil")
        self.assertEqual(viseme_of("☃"), "sil")

    def test_modifiers_have_no_shape(self) -> None:
        for ch in MODIFIERS:
            self.assertIsNone(viseme_of(ch))


class Spans(unittest.TestCase):
    def test_merges_runs_and_extends_through_modifiers(self) -> None:
        timed = [("s", 0.0, 0.05), ("ˈ", 0.05, 0.08), ("z", 0.08, 0.1), ("oʊ"[0], 0.1, 0.2), (" ", 0.2, 0.25)]
        self.assertEqual(spans(timed), [Span("SS", 0, 100), Span("oh", 100, 200), Span("sil", 200, 250)])

    def test_drops_empty_spans(self) -> None:
        self.assertEqual(spans([("p", 0.1, 0.1), ("a", 0.1, 0.2)]), [Span("aa", 100, 200)])

    def test_spans_are_ordered_and_disjoint(self) -> None:
        out = spans([(p, i * 0.05, (i + 1) * 0.05) for i, p in enumerate("aɪ kˈaʊnt ˈɛvɹi sˈoʊl.")])
        for a, b in zip(out, out[1:]):
            self.assertLessEqual(a.end_ms, b.start_ms)
            self.assertNotEqual(a.v, b.v)

    def test_uniform_covers_the_audio(self) -> None:
        out = uniform(list("pa"), 1.0)
        self.assertEqual(out, [Span("PP", 0, 500), Span("aa", 500, 1000)])
        self.assertEqual(uniform([], 1.0), [])

    def test_to_json_uses_contract_keys(self) -> None:
        self.assertEqual(Span("PP", 1, 2).to_json(), {"v": "PP", "startMs": 1, "endMs": 2})


if __name__ == "__main__":
    unittest.main()
