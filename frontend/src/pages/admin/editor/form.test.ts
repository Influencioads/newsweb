import { describe, expect, it } from 'vitest';

import { bodyDoc, extract, extractImages, imageMarker, wordCount, type BodyImage } from './form';

const img: BodyImage = {
  media: { id: 7, url: '/media/a/800.webp', alt_te: 'ఫోటో', credit: 'WOW', width: 800, height: 600 },
  caption: 'గ్రామ సభ',
};

describe('body pictures', () => {
  it('turns a marker line into an image node between paragraphs', () => {
    const doc = bodyDoc(`మొదటి పేరా\n\n${imageMarker(7)}\n\nరెండో పేరా`, { '7': img });
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(doc.content[1]).toMatchObject({ attrs: { src: '/media/a/800.webp', media_id: 7, caption: 'గ్రామ సభ' } });
  });

  it('drops a marker whose picture was removed', () => {
    const doc = bodyDoc(`ఒకటి\n\n${imageMarker(9)}`, {});
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph']);
  });

  it('round-trips through the stored body', () => {
    const text = `మొదటి పేరా\n\n${imageMarker(7)}\n\nరెండో పేరా`;
    const doc = bodyDoc(text, { '7': img });
    expect(extract(doc)).toBe(text);
    expect(extractImages(doc)['7']).toMatchObject({ caption: 'గ్రామ సభ', media: { id: 7, width: 800 } });
  });

  it('does not count the marker as words', () => {
    expect(wordCount(`ఒకటి రెండు\n\n${imageMarker(7)}`)).toBe(2);
  });
});
