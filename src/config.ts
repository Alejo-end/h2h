// Where the Order buttons go. Put the order form's address (Tally or Google Forms) in
// ORDER_URL; while it is empty, every Order button opens the GitHub issue form instead.
export const ORDER_URL = "";
export const ISSUE_URL = "https://github.com/Alejo-end/h2h/issues/new?template=ask.yml";
export const orderHref = () => ORDER_URL || ISSUE_URL;
