/**
 * The contract's wording: blank lines start paragraphs, and short lines in
 * capitals or starting with a number read as headings.
 */
export default function ContractText({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
      {body.split(/\n\s*\n/).map((block, i) => {
        const text = block.trim();
        const [first, ...rest] = text.split("\n");
        const heading =
          first.length < 60 && (/^\d+[.)]\s/.test(first) || first === first.toUpperCase());
        return heading ? (
          <div key={i}>
            <h3 className="font-semibold">{first}</h3>
            {rest.length > 0 && <p className="whitespace-pre-line">{rest.join("\n")}</p>}
          </div>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {text}
          </p>
        );
      })}
    </div>
  );
}
