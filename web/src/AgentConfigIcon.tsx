import { useId } from 'react';
import type { AgentName } from './api';

type AgentConfigIconProps = {
  readonly agent: AgentName;
};

/**
 * Renders the official brand mark for each agent we manage.
 *
 * The marks are inlined as SVG so a) styling is consistent with the
 * rest of the icon system, b) the bundle ships no per-mark binary
 * file, and c) the marks render correctly inside <button> tabs and
 * detail rows without an additional fetch.
 *
 * Usage scope is product identification: each <AgentConfigIcon /> is
 * always paired with the agent's textual label and never used as a
 * standalone trademark. We do not redistribute the brand assets and
 * we don't claim affiliation with any of the upstream projects.
 */
export function AgentConfigIcon({ agent }: AgentConfigIconProps) {
  const codexGradientId = useId();

  switch (agent) {
    case 'codex':
      return (
        <svg className="agent-config-logo agent-config-logo--codex" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19.503 0H4.496A4.496 4.496 0 0 0 0 4.496v15.007A4.496 4.496 0 0 0 4.496 24h15.007A4.496 4.496 0 0 0 24 19.503V4.496A4.496 4.496 0 0 0 19.503 0z" fill="#fff" />
          <path
            d="M9.064 3.344a4.578 4.578 0 0 1 2.285-.312c1 .115 1.891.54 2.673 1.275a.09.09 0 0 0 .08.021 4.55 4.55 0 0 1 3.046.275l.047.022.116.057a4.581 4.581 0 0 1 2.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 0 1-.134 1.223.123.123 0 0 0 .03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 0 1-2.201 1.388.123.123 0 0 0-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 0 0-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 0 1-1.945-.466 4.544 4.544 0 0 1-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 0 1-.37-.961 4.582 4.582 0 0 1-.014-2.298.124.124 0 0 0 .006-.056.085.085 0 0 0-.027-.048 4.467 4.467 0 0 1-1.034-1.651 3.896 3.896 0 0 1-.251-1.192 5.189 5.189 0 0 1 .141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 0 0 .065-.066 4.51 4.51 0 0 1 .829-1.615 4.535 4.535 0 0 1 1.837-1.388zm3.482 10.565a.637.637 0 0 0 0 1.272h3.636a.637.637 0 1 0 0-1.272h-3.636zM8.462 9.23a.637.637 0 0 0-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 1 0 1.095.649l1.454-2.455a.636.636 0 0 0 .005-.64L8.462 9.23z"
            fill={`url(#${codexGradientId})`}
          />
          <defs>
            <linearGradient id={codexGradientId} x1="12" x2="12" y1="3" y2="21" gradientUnits="userSpaceOnUse">
              <stop stopColor="#B1A7FF" />
              <stop offset=".5" stopColor="#7A9DFF" />
              <stop offset="1" stopColor="#3941FF" />
            </linearGradient>
          </defs>
        </svg>
      );
    case 'opencode':
      return (
        <svg className="agent-config-logo agent-config-logo--opencode" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
          <rect width="512" height="512" fill="#131010" />
          <path d="M320 224V352H192V224H320Z" fill="#5A5858" />
          <path fillRule="evenodd" clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white" />
        </svg>
      );
    case 'openclaw':
      return (
        <svg className="agent-config-logo agent-config-logo--openclaw" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect width="16" height="16" fill="none" />
          <g fill="#3a0a0d">
            <rect x="1" y="5" width="1" height="3" />
            <rect x="2" y="4" width="1" height="1" />
            <rect x="2" y="8" width="1" height="1" />
            <rect x="3" y="3" width="1" height="1" />
            <rect x="3" y="9" width="1" height="1" />
            <rect x="4" y="2" width="1" height="1" />
            <rect x="4" y="10" width="1" height="1" />
            <rect x="5" y="2" width="6" height="1" />
            <rect x="11" y="2" width="1" height="1" />
            <rect x="12" y="3" width="1" height="1" />
            <rect x="12" y="9" width="1" height="1" />
            <rect x="13" y="4" width="1" height="1" />
            <rect x="13" y="8" width="1" height="1" />
            <rect x="14" y="5" width="1" height="3" />
            <rect x="5" y="11" width="6" height="1" />
            <rect x="4" y="12" width="1" height="1" />
            <rect x="11" y="12" width="1" height="1" />
            <rect x="3" y="13" width="1" height="1" />
            <rect x="12" y="13" width="1" height="1" />
            <rect x="5" y="14" width="6" height="1" />
          </g>
          <g fill="#ff4f40">
            <rect x="5" y="3" width="6" height="1" />
            <rect x="4" y="4" width="8" height="1" />
            <rect x="3" y="5" width="10" height="1" />
            <rect x="3" y="6" width="10" height="1" />
            <rect x="3" y="7" width="10" height="1" />
            <rect x="4" y="8" width="8" height="1" />
            <rect x="5" y="9" width="6" height="1" />
            <rect x="5" y="12" width="6" height="1" />
            <rect x="6" y="13" width="4" height="1" />
          </g>
          <g fill="#ff775f">
            <rect x="1" y="6" width="2" height="1" />
            <rect x="2" y="5" width="1" height="1" />
            <rect x="2" y="7" width="1" height="1" />
            <rect x="13" y="6" width="2" height="1" />
            <rect x="13" y="5" width="1" height="1" />
            <rect x="13" y="7" width="1" height="1" />
          </g>
          <g fill="#081016">
            <rect x="6" y="5" width="1" height="1" />
            <rect x="9" y="5" width="1" height="1" />
          </g>
          <g fill="#f5fbff">
            <rect x="6" y="4" width="1" height="1" />
            <rect x="9" y="4" width="1" height="1" />
          </g>
        </svg>
      );
    case 'claude':
      return (
        <svg className="agent-config-logo agent-config-logo--claude" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="#D97757"
            d="M4.7144 15.9555 9.4318 13.3084l.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
          />
        </svg>
      );
    case 'ohmyopenagent':
      return (
        <svg className="agent-config-logo agent-config-logo--ohmyopenagent" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect width="32" height="32" rx="8" fill="#0a0a0a" />
          <text
            x="16"
            y="23"
            fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
            fontSize="22"
            fontWeight={700}
            fill="#00d4ff"
            textAnchor="middle"
          >
            O
          </text>
        </svg>
      );
  }
}
