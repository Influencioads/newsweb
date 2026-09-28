import { describe, expect, it } from 'vitest';

import { transliterate } from './transliterate';

describe('transliterate', () => {
  it.each([
    ['telugu', 'తెలుగు'],
    ['namaskaaram', 'నమస్కారం'.replace('ం', 'మ్')],
    ['namaskaaraM', 'నమస్కారం'],
    ['aaMdhra', 'ఆంధ్ర'],
    ['vaarta', 'వార్త'],
    ['TamaaTaa', 'టమాటా'],
    ['pOlIsu', 'పోలీసు'],
    ['haidaraabaad', 'హైదరాబాద్'],
    ['kShEtraM', 'క్షేత్రం'],
    ['kRuShi', 'కృషి'],
    ['iMTi', 'ఇంటి'],
    ['viSEsha', 'విశేశ'],
  ])('%s → %s', (latin, te) => expect(transliterate(latin)).toBe(te));
});
