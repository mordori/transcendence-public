import { useState } from 'react'
import { LampHeading } from "@/components/ui/lamp-heading"
import Popup, { type PopupKind } from "@/components/Popup"

const Footer = () => {
  const [popup, setPopup] = useState<PopupKind | null >(null)

  return (
    <>
      <div className="FOOTER absolute inset-x-0 bottom-0 pt-[clamp(16px,2vw,32px)] px-[clamp(24px,5vw,120px)] pb-[clamp(24px,4vh,60px)] flex items-end">

        <div className="FOOTER_LEFT flex-1 flex justify-center gap-[clamp(32px,6vw,120px)]">
          <button
            onClick={() => setPopup('tos')}
            className="bg-transparent border-none p-0 cursor-pointer"
          >
            <LampHeading
              text="Terms of Service"
              fontSize="clamp(10px, 1vw, 30px)"
              className="text-teal-700 dark:text-teal-300"
              direction="above"
              showLightRays={false}
              showParticles={true}
              gradientColors={{ from: "#00FFFF", via: "#00CED1", to: "#20B2AA" }}
              glowIntensity={1.3}
              lineHeight={6}
            />
          </button>

          <button
            onClick={() => setPopup('priv')}
            className="bg-transparent border-none p-0 cursor-pointer"
          >
            <LampHeading
              text="Privacy Policy"
              fontSize="clamp(10px, 1vw, 30px)"
              className="text-teal-700 dark:text-teal-300"
              direction="above"
              showLightRays={false}
              showParticles={true}
              gradientColors={{ from: "#00FFFF", via: "#00CED1", to: "#20B2AA" }}
              glowIntensity={1.3}
              lineHeight={6}
            />
          </button>
        </div>

          <div className="footer-right flex-1 flex justify-center">
            <button
              onClick={() => setPopup('cre')}
              className="bg-transparent border-none p-0 cursor-pointer"
            >
              <LampHeading
                text="Credits"
                fontSize="clamp(10px, 1vw, 30px)"
                className="text-teal-700 dark:text-teal-300"
                direction="above"
                showLightRays={false}
                showParticles={true}
                gradientColors={{ from: "#00FFFF", via: "#00CED1", to: "#20B2AA" }}
                glowIntensity={1.3}
                lineHeight={6}
              />
            </button>
          </div>
      </div>

      <Popup kind={popup} onClose={() => setPopup(null)} />
    </>
  )
}

export default Footer