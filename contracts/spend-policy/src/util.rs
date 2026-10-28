//! Plain-language formatting for refusal messages and the calendar month used for spend periods.

/// "$5,150.00" from token base units (6 decimals). Sub-cent remainders are dropped.
pub fn usd(units: u128) -> String {
    let cents = units / 10_000;
    let dollars = (cents / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in dollars.chars().enumerate() {
        if i > 0 && (dollars.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("${}.{:02}", grouped, cents % 100)
}

/// "raw_material" → "raw material", for messages staff read.
pub fn label(category: &str) -> String {
    category.replace('_', " ")
}

/// Calendar month `YYYYMM` (UTC) from a block timestamp in nanoseconds.
pub fn period(timestamp_ns: u64) -> u32 {
    // Days since 1970-01-01 to a civil date (H. Hinnant's algorithm), non-negative inputs only.
    let z = timestamp_ns / 86_400_000_000_000 + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year * 100 + month) as u32
}

/// A SHA-256 fingerprint written as 64 lowercase hex characters.
pub fn is_hash(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_dollars() {
        assert_eq!(usd(5_150_000_000), "$5,150.00");
        assert_eq!(usd(2_500_000_000), "$2,500.00");
        assert_eq!(usd(612_000_000), "$612.00");
        assert_eq!(usd(19_000_000), "$19.00");
        assert_eq!(usd(60_000_000_000), "$60,000.00");
        assert_eq!(usd(1_234_567_890_000), "$1,234,567.89");
        assert_eq!(usd(0), "$0.00");
    }

    #[test]
    fn finds_the_calendar_month() {
        // 2026-11-09T13:00:00Z, the demo clock.
        assert_eq!(period(1_794_229_200_000_000_000), 202611);
        // 2026-12-31T23:59:59Z and 2027-01-01T00:00:00Z.
        assert_eq!(period(1_798_761_599_000_000_000), 202612);
        assert_eq!(period(1_798_761_600_000_000_000), 202701);
        // 2028-02-29T12:00:00Z (leap day).
        assert_eq!(period(1_835_438_400_000_000_000), 202802);
    }

    #[test]
    fn checks_hashes() {
        assert!(is_hash(&"ab".repeat(32)));
        assert!(!is_hash(&"AB".repeat(32)));
        assert!(!is_hash("abc"));
    }
}
