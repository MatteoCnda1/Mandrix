import { retroYear } from '@mandrix/shared';
import { CaretRight, Confetti } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';

/** Carte « Ta rétro est prête », sur le fil du 1er décembre au 31 janvier (#90). */
export function RetroBanner() {
  const nav = useNavigate();
  const year = retroYear();
  if (year === null) return null;
  return (
    <button
      type="button"
      onClick={() => nav('/retro')}
      className="tap flex animate-in items-center gap-3.5 rounded-[28px] border-0 bg-gradient-to-br from-[#7b2ff7] to-[#e5484d] p-4 text-left text-white shadow-hero transition-transform active:scale-[.98]"
    >
      <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-white/20">
        <Confetti size={26} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.0625rem] font-extrabold">Ta rétro {year} est prête</span>
        <span className="block text-sm text-white/85">Tes posts, ta Pellicule, tes mèmes et ta bande, en quelques diapos.</span>
      </span>
      <CaretRight size={20} weight="bold" />
    </button>
  );
}
