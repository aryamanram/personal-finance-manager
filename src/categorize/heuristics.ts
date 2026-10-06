/**
 * Built-in patterns: what a bank description says about itself, before any
 * history has been learned.
 *
 * THIS FILE IS PUBLIC. Everything here is generic — standard bank phrasing and
 * national chains anyone might use. Nothing is drawn from the owner's ledger;
 * a merchant specific to one person belongs in their history (which the
 * guesser learns from the database) or in `private/my-rules.ts`.
 *
 * Two tiers, because they deserve different trust:
 *
 *   STRUCTURAL — the description states what the money IS: an ATM withdrawal,
 *                a fee, a card payment, a transfer between own accounts.
 *                Direction-aware and near-certain.
 *   KEYWORD    — the description names a merchant whose trade is well known.
 *                A reasonable first guess, and only ever a guess.
 *
 * Categories are referenced by NAME and resolved against the live table, so a
 * renamed or archived category silently drops its patterns rather than
 * writing a stale id.
 */
import type { AccountType } from '@/lib/types';

export type Direction = 'in' | 'out';

export interface Pattern {
  category: string;
  /** Matched case-insensitively against the whitespace-collapsed description. */
  re: RegExp;
  /** Only money moving this way. Omitted: either. */
  direction?: Direction;
  /** Only on this kind of account. Omitted: any. */
  accountType?: AccountType;
  /** Shown to the reviewer as the reason for the guess. */
  label: string;
}

export const STRUCTURAL: readonly Pattern[] = [
  // The card's own leg of a card payment. Mirrors is_card_payment_credit.
  { category: 'Credit Card Payment', direction: 'in', accountType: 'credit',
    re: /\b(PAYMENT|AUTOPAY|THANK YOU|ACH DEPOSIT)\b/i, label: 'payment received by a card' },
  { category: 'Credit Card Payment', direction: 'out', accountType: 'depository',
    re: /\bPAYMENT TO .*CARD\b|\bCARD ?(SERVICES|MEMBER SERV)|\bCRCARDPMT\b|\bE-?PAYMENT\b|\bAPPLECARD\b|\bAUTOPAY\b/i,
    label: 'paying off a card' },

  { category: 'Account Transfer',
    re: /\b(ONLINE|INTERNET|MOBILE) TRANSFER (FROM|TO)\b|\bTRANSFER (FROM|TO) (CHK|SAV|CHECKING|SAVINGS|ACCOUNT)\b/i,
    label: 'transfer between own accounts' },

  { category: 'Cash Withdrawn', direction: 'out',
    re: /\bATM (CASH )?WITHDRAW|\bCASH WITHDRAWAL\b/i, label: 'ATM withdrawal' },
  { category: 'Fees & Interest', direction: 'out',
    re: /\b(ATM|SERVICE|MONTHLY|LATE|OVERDRAFT|ANNUAL|WIRE|RETURNED ITEM|MAINTENANCE) (\w+ )?FEE\b|\bFOREIGN (EXCHANGE|TRANSACTION)\b.*\bFEE\b|\bINTEREST CHARGE/i,
    label: 'bank fee or interest charge' },

  { category: 'Interest & Dividends', direction: 'in',
    re: /\bINTEREST (PAYMENT|PAID|EARNED)\b|\bDIVIDEND/i, label: 'interest or dividend paid' },
  { category: 'Paycheck', direction: 'in',
    re: /\bPAYROLL\b|\bDIR(ECT)? ?DEP\b|\bSALARY\b/i, label: 'payroll deposit' },
  // A peer-payment cash-out or incoming Zelle is money coming back, not income
  // earned. The direction is the signal, not the rail (see docs/STATE.md).
  { category: 'Reimbursement', direction: 'in',
    re: /\bCASHOUT\b|\bZELLE (PAYMENT )?FROM\b|\bBNF-VENMO\b/i, label: 'peer payment received' },

  { category: 'Taxes', direction: 'out',
    re: /\bIRS\b|\bUSATAXPYMT\b|\bDEPT OF REVENUE\b|\bFRANCHISE TAX\b/i, label: 'tax payment' },
  { category: 'Student Loan', direction: 'out',
    re: /\bSTUDENT LN\b|\bNAVIENT\b|\bNELNET\b|\bMOHELA\b|\bAIDVANTAGE\b|\bDEPT EDUCATION\b/i,
    label: 'student loan servicer' },
  { category: 'Brokerage Contribution', direction: 'out',
    re: /\bROBINHOOD\b|\bVANGUARD\b|\bFIDELITY\b|\bSCHWAB\b|\bE\*?TRADE\b|\bWEALTHFRONT\b|\bBETTERMENT\b|\bMORGAN STANLEY\b/i,
    label: 'brokerage' },
];

/**
 * Ordered: first match wins, so a narrower pattern sits above a broader one
 * that would also catch it ("UBER EATS" before "UBER").
 */
export const KEYWORD: readonly Pattern[] = [
  { category: 'Restaurants', re: /\bUBER ?EATS\b|\bDOORDASH\b|\bGRUBHUB\b|\bPOSTMATES\b|\bSEAMLESS\b/i, label: 'food delivery' },
  { category: 'Rideshare', re: /\bUBER\b|\bLYFT\b/i, label: 'rideshare' },

  { category: 'Coffee', re: /\bSTARBUCKS\b|\bDUNKIN\b|\bPEET'?S\b|\bBLUE BOTTLE\b|\bCOFFEE\b|\bESPRESSO\b/i, label: 'coffee' },
  { category: 'Restaurants',
    re: /\bMCDONALD|\bCHIPOTLE\b|\bSUBWAY\b|\bTACO BELL\b|\bWENDY'?S\b|\bBURGER KING\b|\bCHICK-?FIL-?A\b|\bPANERA\b|\bSHAKE SHACK\b|\bFIVE GUYS\b|\bDOMINO'?S\b|\bPIZZA\b|\bSUSHI\b|\bRAMEN\b|\bTAQUERIA\b|\bGRILL\b|\bKITCHEN\b|\bBISTRO\b|\bTAVERN\b|\bRESTAURANT\b|\bDINER\b|\bBBQ\b|\bCAFE\b|\bBAKERY\b|\bBREWING\b|\bPUB\b|\bSWEETGREEN\b/i,
    label: 'restaurant' },
  { category: 'Groceries',
    re: /\bWHOLE ?FOODS\b|\bWHOLEFDS\b|\bTRADER JOE|\bALDI\b|\bKROGER\b|\bSAFEWAY\b|\bPUBLIX\b|\bJEWEL\b|\bMARIANO|\bWEGMANS\b|\bH-?E-?B\b|\bSPROUTS\b|\bGROCER|\bSUPERMARKET\b|\bSAM'?S CLUB\b/i,
    label: 'grocery' },
  { category: 'Gas',
    re: /\bSHELL\b|\bEXXON|\bMOBIL\b|\bCHEVRON\b|\bBP\b|\bSUNOCO\b|\bCITGO\b|\bMARATHON\b|\bSPEEDWAY\b|\bVALERO\b|\bCIRCLE K\b|\bCOSTCO GAS\b|\bFUEL\b|\bGAS STATION\b/i,
    label: 'fuel' },
  { category: 'Parking & Tolls', re: /\bPARKING\b|\bPARKWHIZ\b|\bSPOTHERO\b|\bE-?Z ?PASS\b|\bI-?PASS\b|\bTOLL/i, label: 'parking or toll' },

  { category: 'Flights',
    re: /\bUNITED\b|\bAMERICAN AIR|\bDELTA AIR|\bSOUTHWEST\b|\bJETBLUE\b|\bALASKA AIR|\bSPIRIT AIR|\bFRONTIER\b|\bAIRLINE|\bAIRWAYS\b/i,
    label: 'airline' },
  { category: 'Travel',
    re: /\bAIRBNB\b|\bVRBO\b|\bMARRIOTT\b|\bHILTON\b|\bHYATT\b|\bIHG\b|\bHOTEL|\bEXPEDIA\b|\bBOOKING\.COM\b|\bAMTRAK\b|\bHERTZ\b|\bAVIS\b|\bENTERPRISE RENT/i,
    label: 'lodging or travel' },

  { category: 'Pharmacy', re: /\bCVS\b|\bWALGREENS\b|\bRITE AID\b|\bPHARMACY\b/i, label: 'pharmacy' },
  { category: 'Fitness', re: /\bPLANET FITNESS\b|\bEQUINOX\b|\bCRUNCH\b|\bORANGETHEORY\b|\bGYM\b|\bFITNESS\b|\bYOGA\b|\bCLIMBING\b/i, label: 'fitness' },
  { category: 'Personal Care', re: /\bBARBER|\bSALON\b|\bSPA\b|\bULTA\b|\bSEPHORA\b/i, label: 'personal care' },

  { category: 'Streaming & Video',
    re: /\bNETFLIX\b|\bHULU\b|\bDISNEY ?PLUS\b|\bDISNEYPLUS\b|\bYOUTUBE ?PREM|\bYOUTUBEPREMI|\bHBO ?MAX\b|\bMAX\.COM\b|\bPEACOCK\b|\bPARAMOUNT\+?|\bCRUNCHYROLL\b|\bAPPLE ?TV\b/i,
    label: 'streaming' },
  { category: 'Music & Audio', re: /\bSPOTIFY\b|\bAPPLE ?MUSIC\b|\bTIDAL\b|\bAUDIBLE\b|\bSIRIUSXM\b|\bPANDORA\b/i, label: 'music or audio' },
  { category: 'AI Tools', re: /\bOPENAI\b|\bCHATGPT\b|\bANTHROPIC\b|\bCLAUDE\.AI\b|\bCURSOR\b|\bMIDJOURNEY\b|\bPERPLEXITY\b/i, label: 'AI tool' },
  { category: 'Hosting & Domains', re: /\bNAMECHEAP\b|\bGODADDY\b|\bSQUARESPACE\b|\bVERCEL\b|\bNETLIFY\b|\bDIGITALOCEAN\b|\bCLOUDFLARE\b/i, label: 'hosting or domains' },
  { category: 'Software & Cloud',
    re: /\bGITHUB\b|\bAWS\b|\bAMAZON WEB SERVICES\b|\bGOOGLE ?CLOUD\b|\bGOOGLE ?STORAGE\b|\bICLOUD\b|\bDROPBOX\b|\bADOBE\b|\bNOTION\b|\bFIGMA\b|\bMICROSOFT 365\b|\b1PASSWORD\b/i,
    label: 'software' },
  { category: 'Creator Support', re: /\bPATREON\b|\bSUBSTACK\b|\bKO-?FI\b/i, label: 'creator support' },
  { category: 'News & Reading', re: /\bNYTIMES\b|\bNEW YORK TIMES\b|\bWSJ\b|\bWASHINGTON POST\b|\bECONOMIST\b|\bMEDIUM\.COM\b/i, label: 'news' },
  { category: 'Gaming', re: /\bXBOX\b|\bGAME ?PASS\b|\bPLAYSTATION NETWORK\b|\bPS ?PLUS\b|\bNINTENDO ONLINE\b/i, label: 'gaming subscription' },

  { category: 'Video Games', re: /\bSTEAM ?(GAMES|PURCHASE|POWERED)\b|\bSTEAMGAMES\b|\bEPIC ?GAMES\b|\bNINTENDO\b|\bPLAYSTATION\b|\bGOG\.COM\b/i, label: 'video game store' },
  { category: 'Live Events', re: /\bTICKETMASTER\b|\bLIVE ?NATION\b|\bSTUBHUB\b|\bSEATGEEK\b|\bAXS\b|\bEVENTBRITE\b|\bTM \*/i, label: 'tickets' },
  { category: 'Movies & Theater', re: /\bAMC\b|\bREGAL\b|\bCINEMARK\b|\bCINEMA\b|\bTHEATRE\b|\bTHEATER\b|\bFANDANGO\b/i, label: 'cinema or theater' },
  { category: 'Museums & Attractions', re: /\bMUSEUM\b|\bZOO\b|\bAQUARIUM\b|\bBOTANIC|\bGALLERY\b/i, label: 'museum or attraction' },
  { category: 'Books', re: /\bBARNES ?& ?NOBLE\b|\bBOOKSTORE\b|\bBOOKS\b|\bKINDLE\b/i, label: 'books' },

  { category: 'Online Marketplace', re: /\bAMAZON\b|\bAMZN\b|\bEBAY\b|\bETSY\b|\bMERCARI\b|\bTEMU\b|\bALIEXPRESS\b/i, label: 'online marketplace' },
  { category: 'Electronics', re: /\bAPPLE STORE\b|\bAPPLE\.COM\b|\bBEST ?BUY\b|\bB&H\b|\bNEWEGG\b|\bCAMERA\b/i, label: 'electronics' },
  { category: 'Clothing', re: /\bUNIQLO\b|\bZARA\b|\bH&M\b|\bGAP\b|\bNORDSTROM\b|\bMACY'?S\b|\bBLOOMINGDALE|\bNIKE\b|\bADIDAS\b|\bJ\.? ?CREW\b/i, label: 'clothing' },
  { category: 'Flea & Thrift', re: /\bTHRIFT\b|\bGOODWILL\b|\bVINTAGE\b|\bFLEA\b|\bSALVATION ARMY\b/i, label: 'thrift or vintage' },
  { category: 'Games & Hobbies', re: /\bGAMES\b|\bHOBBY\b|\bHOBBIES\b|\bCOMICS?\b|\bTCG\b|\bCOLLECTIBLE/i, label: 'games or hobby shop' },
  { category: 'Home Goods', re: /\bHOME DEPOT\b|\bLOWE'?S\b|\bCONTAINER ?STORE\b|\bBED BATH\b|\bHOMEGOODS\b|\bACE HARDWARE\b/i, label: 'home goods' },
  { category: 'Home & Furniture', re: /\bIKEA\b|\bWAYFAIR\b|\bCB2\b|\bCRATE ?& ?BARREL\b|\bWEST ELM\b|\bMATTRESS\b/i, label: 'furniture' },
  { category: 'Shopping', re: /\bTARGET\b|\bWALMART\b|\bWAL-MART\b|\bCOSTCO\b/i, label: 'general retail' },

  { category: 'Internet & Phone', re: /\bCOMCAST\b|\bXFINITY\b|\bVERIZON\b|\bT-?MOBILE\b|\bAT&T\b|\bSPECTRUM\b|\bMINT MOBILE\b|\bGOOGLE ?FI\b/i, label: 'internet or phone' },
  { category: 'Utilities', re: /\bCOMED\b|\bCON ?ED\b|\bPG&E\b|\bPEOPLES GAS\b|\bNICOR\b|\bELECTRIC\b|\bWATER DEPT\b|\bUTILIT/i, label: 'utility' },
  { category: 'Renters Insurance', re: /\bLEMONADE\b|\bRENTERS\b/i, label: 'renters insurance' },
  { category: 'Auto Insurance', re: /\bGEICO\b|\bPROGRESSIVE\b|\bSTATE FARM\b|\bALLSTATE\b/i, label: 'auto insurance' },
  { category: 'Insurance Premium', re: /\bINSURANCE\b/i, label: 'insurance' },
  { category: 'Rent', direction: 'out', re: /\bRENT\b/i, label: 'rent' },
];

/** Collapses the fixed-width padding bank exports add, so one pattern reads both forms. */
export function collapse(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** The first pattern in `list` that applies to this row, or null. */
export function firstMatch(
  list: readonly Pattern[],
  raw: string,
  direction: Direction,
  accountType: AccountType,
): Pattern | null {
  const text = collapse(raw);
  for (const p of list) {
    if (p.direction && p.direction !== direction) continue;
    if (p.accountType && p.accountType !== accountType) continue;
    if (p.re.test(text)) return p;
  }
  return null;
}
