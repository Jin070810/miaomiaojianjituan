import { ChevronRight } from "lucide-react";
import Image from "next/image";
import { miaoAssets } from "./visual-assets";

export function BirthdayEntry({ onOpen }: { onOpen: () => void }) {
  return <section className="birthday-entry" aria-labelledby="birthday-entry-title"><Image src={miaoAssets.actions.gift.src} width={120} height={160} sizes="120px" alt="" /><div><span>团友生日册</span><h2 id="birthday-entry-title">生日星愿</h2><p>登记生日、抽取年度心意，也为团友送上一张祝福卡。</p></div><button onClick={onOpen} aria-label="进入生日星愿"><ChevronRight size={22} /></button></section>;
}
