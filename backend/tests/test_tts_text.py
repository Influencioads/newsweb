"""Read copy vs print copy. Every case here is a mistake Sarvam's own STT heard
in the audio on 2026-09-19, a Telugu numeral form a table gets wrong, or a
counterexample one of three independent reviewers produced the same day."""

from __future__ import annotations

import pytest

from app.services.tts_text import assemble, for_speech, number_words, same_sentence

ZWNJ = "‌"


class TestNumerals:
    @pytest.mark.parametrize(
        ("n", "expected"),
        [
            (0, "సున్నా"), (5, "ఐదు"), (12, "పన్నెండు"), (18, "పద్దెనిమిది"), (20, "ఇరవై"),
            (21, "ఇరవై ఒకటి"), (26, "ఇరవై ఆరు"), (99, "తొంభై తొమ్మిది"),
            (100, "వంద"), (105, "నూట ఐదు"), (126, "నూట ఇరవై ఆరు"),
            (300, "మూడు వందలు"), (350, "మూడు వందల యాభై"), (905, "తొమ్మిది వందల ఐదు"),
            (1000, "వెయ్యి"), (1005, "వెయ్యి ఐదు"), (1099, "వెయ్యి తొంభై తొమ్మిది"),
            # 1100–1999 in hundreds: the year form, and the on-air form for a sum.
            (1100, "పదకొండు వందలు"), (1250, "పన్నెండు వందల యాభై"), (1500, "పదిహేను వందలు"),
            (1947, "పందొమ్మిది వందల నలభై ఏడు"), (1956, "పందొమ్మిది వందల యాభై ఆరు"), (1900, "పందొమ్మిది వందలు"),
            (2000, "రెండు వేలు"), (2026, "రెండు వేల ఇరవై ఆరు"), (8000, "ఎనిమిది వేలు"),
            (8400, "ఎనిమిది వేల నాలుగు వందలు"), (12000, "పన్నెండు వేలు"),
            # The attributive: "ఇరవై ఒక వేలు", never "ఇరవై ఒకటి వేలు".
            (21000, "ఇరవై ఒక వేలు"), (121000, "లక్షా ఇరవై ఒక వేలు"),
            (100000, "లక్ష"), (180000, "లక్షా ఎనభై వేలు"), (250000, "రెండు లక్షల యాభై వేలు"),
            (4100000, "నలభై ఒక లక్షలు"),
            (10000000, "కోటి"), (12500000, "కోటి ఇరవై ఐదు లక్షలు"), (25000000, "రెండు కోట్ల యాభై లక్షలు"),
            (1010000000, "నూట ఒక కోట్లు"),
            (123450000000, "పన్నెండు వేల మూడు వందల నలభై ఐదు కోట్లు"),
        ],
    )
    def test_reads_like_a_telugu_speaker(self, n: int, expected: str) -> None:
        assert number_words(n) == expected

    def test_oblique_when_a_noun_follows(self) -> None:
        assert number_words(2000, oblique=True) == "రెండు వేల"
        assert number_words(180000, oblique=True) == "లక్షా ఎనభై వేల"
        assert number_words(1250, oblique=True) == "పన్నెండు వందల యాభై"
        assert number_words(26, oblique=True) == "ఇరవై ఆరు"


class TestHeardMistakes:
    def test_rupee_sign_moves_to_the_end_in_telugu(self) -> None:
        """Heard: "…యాభై రూపీస్ కోట్లు". The sign is first on paper, last aloud."""
        assert for_speech("తొలి విడతగా ₹1,250 కోట్లు విడుదల చేసింది.") == (
            "తొలి విడతగా 1,250 కోట్ల రూపాయలు విడుదల చేసింది."
        )
        assert for_speech("₹500 జరిమానా") == "500 రూపాయలు జరిమానా."
        assert for_speech("₹1,250 కోట్ల నిధులు") == "1,250 కోట్ల రూపాయల నిధులు."

    def test_rupee_with_a_case_suffix(self) -> None:
        """Reviewer: "₹10 కోట్లతో" wedged రూపాయలు mid-phrase; "₹500కు" was not
        matched at all and the sign reached Sarvam as "రూపీస్"."""
        assert for_speech("₹10 కోట్లతో నిర్మించిన వంతెన") == "10 కోట్ల రూపాయలతో నిర్మించిన వంతెన."
        assert for_speech("₹500కు పైగా వసూలు") == "500 రూపాయలకు పైగా వసూలు."
        assert for_speech("₹1.5 లక్షలకు పైగా") == "లక్షా యాభై వేల రూపాయలకు పైగా."

    def test_lakh_crore_the_budget_phrase(self) -> None:
        """Reviewer: two scale words and two decimals — "3.22 lakh rupees crore"."""
        assert for_speech("₹3.22 లక్షల కోట్ల బడ్జెట్") == "మూడు లక్షల ఇరవై రెండు వేల కోట్ల రూపాయల బడ్జెట్."
        assert for_speech("3.22 లక్షల కోట్లు") == "మూడు లక్షల ఇరవై రెండు వేల కోట్లు."

    def test_a_grouped_number_with_a_decimal_is_not_split(self) -> None:
        """Reviewer: the decimal rule matched the "250.5" tail of "1,250.5" and
        read a fivefold-smaller figure."""
        assert for_speech("₹1,250.5 కోట్లు") == "పన్నెండు వందల యాభై కోట్ల యాభై లక్షల రూపాయలు."

    def test_percent_is_satam_not_percent(self) -> None:
        assert for_speech("40% పెరుగుదల") == "40 శాతం పెరుగుదల."
        assert for_speech("12.5% వృద్ధి") == "12.5 శాతం వృద్ధి."

    def test_decimal_lakhs_are_expanded_not_pointed(self) -> None:
        """Heard: "ఒకటి పాయింట్ ఎనిమిది లక్షల"."""
        assert for_speech("1.8 లక్షల మంది భక్తులు") == "లక్షా ఎనభై వేల మంది భక్తులు."
        assert for_speech("2.5 కోట్లు ఖర్చు") == "రెండు కోట్ల యాభై లక్షలు ఖర్చు."
        # Two decimal places are routine and were slipping straight through.
        assert for_speech("1.25 లక్షల మంది") == "లక్షా ఇరవై ఐదు వేల మంది."
        assert for_speech("₹2.75 కోట్లు") == "రెండు కోట్ల డెబ్భై ఐదు లక్షల రూపాయలు."
        assert for_speech("1.05 లక్షలు") == "లక్షా ఐదు వేలు."

    def test_years_are_words_not_digits(self) -> None:
        """Heard: "రెండు సున్నా రెండు ఆరు"."""
        assert for_speech("2026 ఏడాదిలో") == "రెండు వేల ఇరవై ఆరు ఏడాదిలో."
        assert for_speech("2026లో జరిగింది") == "రెండు వేల ఇరవై ఆరులో జరిగింది."
        assert for_speech("1947లో స్వాతంత్ర్యం") == "పందొమ్మిది వందల నలభై ఏడులో స్వాతంత్ర్యం."
        # A following "." or "," is still a year; only a digit after it is not.
        assert for_speech("గడువు డిసెంబర్ 2026.") == "గడువు డిసెంబర్ రెండు వేల ఇరవై ఆరు."
        assert for_speech("2019, 2024 ఎన్నికల్లో") == "రెండు వేల పందొమ్మిది, రెండు వేల ఇరవై నాలుగు ఎన్నికల్లో."

    def test_a_round_thousand_before_a_noun_is_oblique(self) -> None:
        """Reviewer: "ఎనిమిది వేలు మంది" is a case error no speaker makes."""
        assert for_speech("8000 మంది") == "ఎనిమిది వేల మంది."
        assert for_speech("3000 కోట్లు") == "మూడు వేల కోట్లు."
        assert for_speech("2000లో") == "రెండు వేలలో."
        assert for_speech("మొత్తం 8000.") == "మొత్తం ఎనిమిది వేలు."

    def test_fiscal_years(self) -> None:
        assert for_speech("2026-27 బడ్జెట్") == "రెండు వేల ఇరవై ఆరు-ఇరవై ఏడు బడ్జెట్."
        assert for_speech("2026–27 బడ్జెట్") == "రెండు వేల ఇరవై ఆరు-ఇరవై ఏడు బడ్జెట్."
        assert for_speech("10–12 మంది") == "10-12 మంది."

    def test_helplines_stay_digits(self) -> None:
        """Reviewer: 1912/1930/1902/1098/1800 end almost every civic story and
        were all read as years."""
        for line in (
            "1912కు కాల్ చేయాలి", "1930కు ఫిర్యాదు చేయాలి", "హెల్ప్‌లైన్ 1098", "నంబర్ 1902",
            "టోల్ ఫ్రీ నంబర్ 1800 425 2026", "డయల్ 1100", "కేసు నం 2026-27",
        ):
            assert for_speech(line) == line + ".", line

    def test_identifiers_stay_digit_by_digit(self) -> None:
        """A PIN, a phone number, a plate: digit by digit IS the right reading."""
        for line in ("పిన్ 500081", "ఫోన్ 9876543210", "AP09CX1234", "12000 మంది"):
            assert for_speech(line) == line + "."
        # A plate written as painted is joined, then left alone.
        assert for_speech("AP 39 AB 1234 నంబర్ కారు") == "AP39AB1234 నంబర్ కారు."
        assert for_speech("TS 09 EA 1234") == "TS09EA1234."

    def test_grouped_and_short_numbers_are_left_alone(self) -> None:
        """8,000 · 905 · 18 · 12వ all came back correct. Do not touch a correct read."""
        assert for_speech("8,000 మంది; 905 కోట్లు; 18 గంటలు; 12వ తేదీ") == (
            "8,000 మంది. 905 కోట్లు. 18 గంటలు. 12వ తేదీ."
        )
        assert for_speech("5,00,000 మంది") == "5,00,000 మంది."

    def test_abbreviations_are_spelled_in_telugu(self) -> None:
        """Heard: CRDA → "సీఆర్డీ" (the A dropped)."""
        assert for_speech("CRDA కమిషనర్") == "సీఆర్‌డీఏ కమిషనర్."
        assert for_speech("IPL మ్యాచ్") == "ఐపీఎల్ మ్యాచ్."
        # Unknown: letter by letter, joined so no conjunct forms.
        assert for_speech("XYZ సంస్థ") == f"ఎక్స్{ZWNJ}వై{ZWNJ}జెడ్ సంస్థ."

    def test_abbreviations_with_a_glued_suffix(self) -> None:
        """Reviewer: `\\b` sees no boundary before a Telugu letter, so the
        dominant form — "MLAలు", "TDPకి" — was skipped entirely."""
        assert for_speech("MLAలు హాజరు") == f"ఎమ్మెల్యే{ZWNJ}లు హాజరు."
        assert for_speech("TDPకి మద్దతు") == f"టీడీపీ{ZWNJ}కి మద్దతు."
        assert for_speech("IASలు") == f"ఐఏఎస్{ZWNJ}లు."

    def test_acronyms_said_as_words(self) -> None:
        assert for_speech("COVID-19 కేసులు") == "కోవిడ్-19 కేసులు."
        assert for_speech("NEET ఫలితాలు") == "నీట్ ఫలితాలు."
        assert for_speech("SENSEX 500 పాయింట్లు") == "సెన్సెక్స్ 500 పాయింట్లు."

    def test_latin_that_is_not_an_abbreviation_is_untouched(self) -> None:
        """A digit glued on (T20, 5G) or mixed case (WhatsApp) is a name, not
        an abbreviation; a hyphen is not a letter, so e-KYC still spells."""
        assert for_speech("T20 మ్యాచ్") == "T20 మ్యాచ్."
        assert for_speech("5G సేవలు") == "5G సేవలు."
        assert for_speech("WhatsApp సందేశం") == "WhatsApp సందేశం."
        assert for_speech("e-KYC పూర్తి") == "e-కేవైసీ పూర్తి."

    def test_headline_breaks_become_full_stops(self) -> None:
        """Measured: `;` and `—` buy a 0.29 s blink, `. ` buys 0.51 s."""
        assert for_speech("తిరుమలలో భక్తుల రద్దీ; సర్వదర్శనానికి 18 గంటలు") == (
            "తిరుమలలో భక్తుల రద్దీ. సర్వదర్శనానికి 18 గంటలు."
        )
        assert for_speech("కీలక దశకు — నేడు సమీక్ష") == "కీలక దశకు. నేడు సమీక్ష."
        assert for_speech("కీలక దశకు - నేడు సమీక్ష") == "కీలక దశకు. నేడు సమీక్ష."
        assert for_speech("నిధులు విడుదల: తొలి విడత") == "నిధులు విడుదల. తొలి విడత."

    def test_clock_times_keep_their_colon(self) -> None:
        assert for_speech("ఉదయం 10:30 గంటలకు") == "ఉదయం 10:30 గంటలకు."
        assert for_speech("రాత్రి 10:30కు చేరుకున్నారు") == "రాత్రి 10:30కు చేరుకున్నారు."

    def test_datelines_become_a_beat(self) -> None:
        assert for_speech("అమరావతి: రాజధాని పనులు వేగవంతం.") == "అమరావతి. రాజధాని పనులు వేగవంతం."
        assert for_speech("అమరావతి, సెప్టెంబర్ 19: రాజధాని పనులు వేగవంతం.") == (
            "అమరావతి, సెప్టెంబర్ 19. రాజధాని పనులు వేగవంతం."
        )

    def test_every_paragraph_ends_as_a_sentence_and_keeps_its_blank_line(self) -> None:
        """A blank line buys its measured 0.92 s only when the line before it ends."""
        assert for_speech("హెడ్‌లైన్\n\nస్టాండ్‌ఫస్ట్\nబాడీ.") == "హెడ్‌లైన్.\n\nస్టాండ్‌ఫస్ట్.\n\nబాడీ."

    def test_no_double_stop_after_a_closing_quote(self) -> None:
        assert for_speech("ఆయన అన్నారు: “వస్తాను.”\n\nతర్వాత వెళ్లారు.") == (
            "ఆయన అన్నారు. “వస్తాను.”\n\nతర్వాత వెళ్లారు."
        )

    def test_ascii_ellipsis_collapses(self) -> None:
        assert for_speech("వేచి చూడాలి... ఇంకా") == "వేచి చూడాలి. ఇంకా."
        assert for_speech("అవును.... కాదు") == "అవును. కాదు."

    def test_idempotent(self) -> None:
        once = for_speech("అమరావతి: CRDA ₹1,250.5 కోట్లతో; 40% — 2026-27, MLAలు 1912కు కాల్")
        assert for_speech(once) == once


class TestAssemble:
    SUMMARY = "పోలవరం ప్రాజెక్టు పనుల పురోగతిపై ముఖ్యమంత్రి సమీక్ష నిర్వహించనున్నారు."
    BODY = ("అమరావతి: పోలవరం ప్రాజెక్టు పనుల పురోగతిపై ముఖ్యమంత్రి బుధవారం సమీక్ష "
            "నిర్వహించనున్నారు. డయాఫ్రం వాల్ పనుల నివేదికను అధికారులు సమర్పించనున్నారు.")

    def test_the_summary_is_not_read_twice(self) -> None:
        """Article 11: summary and body lead were the same sentence, read back to back."""
        out = assemble("పోలవరం కీలక దశకు — నేడు సమీక్ష", "డయాఫ్రం వాల్ పనుల పురోగతిపై నివేదిక", self.SUMMARY, self.BODY)
        assert out.count("ముఖ్యమంత్రి") == 1
        assert out.startswith("పోలవరం కీలక దశకు. నేడు సమీక్ష.")
        assert "అమరావతి. పోలవరం" in out

    def test_word_order_does_not_defeat_the_check(self) -> None:
        """Reviewer: Telugu word order is free; a standfirst that fronts the time
        is the same sentence with two words moved."""
        moved = "బుధవారం ముఖ్యమంత్రి పోలవరం ప్రాజెక్టు పనుల పురోగతిపై సమీక్ష నిర్వహించనున్నారు."
        assert assemble("శీర్షిక", "", moved, self.BODY).count("సమీక్ష") == 1

    def test_a_summary_copied_from_the_headline_is_dropped(self) -> None:
        title = "తిరుమలలో భక్తుల రద్దీ; సర్వదర్శనానికి 18 గంటలు"
        out = assemble(title, title, "", "తిరుమల: భక్తుల రద్దీ కొనసాగుతోంది. మరో వాక్యం.")
        assert out.count("సర్వదర్శనానికి") == 1

    def test_a_dated_dateline_does_not_dilute_the_check(self) -> None:
        body = "అమరావతి, సెప్టెంబర్ 19: " + self.BODY.split(": ", 1)[1]
        assert assemble("శీర్షిక", "", self.SUMMARY, body).count("ముఖ్యమంత్రి") == 1

    def test_a_dotted_abbreviation_in_the_lead_does_not_hide_the_repeat(self) -> None:
        summ = "పోలవరం ప్రాజెక్టుకు కేంద్రం రూ. 1,250 కోట్లు విడుదల చేసింది."
        body = "అమరావతి: పోలవరం ప్రాజెక్టుకు కేంద్రం బుధవారం రూ. 1,250 కోట్లు విడుదల చేసింది. తొలి విడతగా ఈ నిధులు అందాయి."
        assert assemble("శీర్షిక", "", summ, body).count("విడుదల") == 1

    def test_a_summary_that_is_the_second_sentence_is_dropped(self) -> None:
        summ = "డయాఫ్రం వాల్ పనుల నివేదికను అధికారులు సమర్పించనున్నారు."
        assert assemble("శీర్షిక", "", summ, self.BODY).count("నివేదికను") == 1

    def test_a_syndicated_excerpt_is_dropped(self) -> None:
        """Reviewer: a feed's <description> is the first N words of the body
        with an ellipsis — neither a substring nor 0.8-similar to one sentence."""
        excerpt = " ".join(self.BODY.split()[:12]) + "…"
        assert assemble("శీర్షిక", "", excerpt, self.BODY).count("పురోగతిపై") == 1

    def test_a_standfirst_with_a_figure_the_body_lacks_survives(self) -> None:
        """Reviewer: the old symmetric ratio deleted this and the listener
        learned less than the reader."""
        lead = "పోలవరం డయాఫ్రం వాల్ పనులకు కేంద్ర జలసంఘం బుధవారం తుది అనుమతి ఇచ్చిందని ముఖ్యమంత్రి ప్రకటించారు."
        sub = lead[:-1] + ", మరో ₹800 కోట్లు త్వరలో."
        out = assemble("శీర్షిక", sub, "", lead + " ఈ ఏడాది చివరి నాటికి ప్రధాన డ్యామ్ పనులు మొదలవుతాయి.")
        assert "800" in out

    def test_a_genuinely_different_summary_stays(self) -> None:
        out = assemble("శీర్షిక", "", "వర్షాలతో 12 మండలాల్లో అలర్ట్.", "శ్రీకాకుళం: గత 24 గంటల్లో భారీ వర్షాలు కురిశాయి.")
        assert "అలర్ట్" in out and "కురిశాయి" in out

    def test_same_sentence_is_containment_of_the_earlier_part(self) -> None:
        assert same_sentence("ముఖ్యమంత్రి సమీక్ష నిర్వహించనున్నారు", "ముఖ్యమంత్రి బుధవారం సమీక్ష నిర్వహించనున్నారు")
        assert not same_sentence("భారీ వర్షాలు కురిశాయి", "ముఖ్యమంత్రి సమీక్ష నిర్వహించనున్నారు")
        # The longer one is not "contained" in the shorter one.
        assert not same_sentence("ముఖ్యమంత్రి బుధవారం అమరావతిలో సమీక్ష నిర్వహించనున్నారు", "ముఖ్యమంత్రి సమీక్ష")
