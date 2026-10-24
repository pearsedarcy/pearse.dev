/**
 * GSAP motion, loaded on idle after the hero. Everything is gated on
 * prefers-reduced-motion via gsap.matchMedia, and nothing here hides an
 * element that is already on screen when the script arrives.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

const belowFold = (el: Element) => el.getBoundingClientRect().top > window.innerHeight * 0.92;

export function initMotion(): void {
  const mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Headings: per-word rise, once, as they scroll in.
    document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
      if (!belowFold(el)) return;
      const split = SplitText.create(el, { type: 'words', wordsClass: 'split-word' });
      gsap.set(el, { overflow: 'hidden' });
      gsap.from(split.words, {
        yPercent: 110,
        duration: 0.7,
        ease: 'expo.out',
        stagger: 0.035,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      });
    });

    // Cards and rows: a short rise, batched per viewport entry.
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]')).filter(belowFold);
    if (items.length) {
      gsap.set(items, { y: 28, opacity: 0 });
      ScrollTrigger.batch(items, {
        start: 'top 92%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.06, overwrite: true }),
      });
    }

    // Hero name: letters hop when touched. Answers a user action, nothing else.
    const letters = document.querySelectorAll<HTMLElement>('.hero-letter:not(.is-space)');
    const hop = (el: HTMLElement) => {
      if (gsap.isTweening(el)) return;
      gsap.fromTo(
        el,
        { yPercent: 0 },
        { yPercent: -9, duration: 0.16, ease: 'power2.out', yoyo: true, repeat: 1 },
      );
    };
    letters.forEach((el) => el.addEventListener('pointerenter', () => hop(el)));

    return () => {
      letters.forEach((el) => el.replaceWith(el.cloneNode(true)));
    };
  });
}

initMotion();
