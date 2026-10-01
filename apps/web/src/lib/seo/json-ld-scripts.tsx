/** 구조화 데이터를 값마다 `<script type="application/ld+json">` 하나로 싣는다. */
export function JsonLd({ values }: { values: readonly { "@id": string }[] }) {
  return values.map((value) => (
    <script
      key={value["@id"]}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(value) }}
    />
  ));
}
