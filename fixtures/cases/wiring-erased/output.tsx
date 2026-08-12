import { badge } from "./Badge.recipe";

export function Badge(props) {
  const resolved = () => badge.resolve({});
  return <span {...resolved().root}>{props.children}</span>;
}
