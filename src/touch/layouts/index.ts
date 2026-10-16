import { parseLayout, type TouchLayout } from "../layout";
import phone from "./phone.json";

/** The built-in layout: phones in either orientation, and tablets, which get it scaled up. */
export const PHONE_LAYOUT: TouchLayout = parseLayout(phone);
