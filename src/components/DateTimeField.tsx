import { createElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { colors } from "../styles";

type Mode = "date" | "time";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toInputValue(date: Date, mode: Mode) {
  return mode === "date"
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Only the relevant half of the value is meaningful here — the date field
// reports a Date with just year/month/day set, the time field just
// hours/minutes. The caller merges whichever half changed into its own
// state (see MakeEventModal), so a native picker's quirks about what it
// preserves in the other half never matter.
function fromWebInput(text: string, mode: Mode): Date | null {
  if (mode === "date") {
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const m = text.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

function formatDisplay(date: Date, mode: Mode) {
  return mode === "date"
    ? date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A real date or time picker for one field — the browser's native
 *  <input type="date"/"time"> on web, the platform's own picker (a compact
 *  popover on iOS, the system dialog on Android) everywhere else. Reports
 *  only the field it owns; see fromWebInput above for why. */
export function DateTimeField({
  label,
  mode,
  value,
  onChange,
  minimumDate,
}: {
  label: string;
  mode: Mode;
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
}) {
  if (Platform.OS === "web") {
    // react-native-web forwards unrecognized host props straight to the
    // underlying DOM node, but TS's RN JSX types don't know "input" — go
    // through createElement so this stays type-safe everywhere else.
    return (
      <View>
        <Text style={s.label}>{label}</Text>
        {createElement("input", {
          type: mode,
          value: toInputValue(value, mode),
          min: minimumDate && mode === "date" ? toInputValue(minimumDate, mode) : undefined,
          onChange: (e: { target: { value: string } }) => {
            const next = fromWebInput(e.target.value, mode);
            if (next) onChange(next);
          },
          style: webInputStyle,
        })}
      </View>
    );
  }

  if (Platform.OS === "android") {
    return (
      <Pressable
        style={s.androidField}
        onPress={() =>
          DateTimePickerAndroid.open({
            value,
            mode,
            minimumDate,
            onChange: (_event, selected) => {
              if (selected) onChange(selected);
            },
          })
        }
      >
        <Text style={s.label}>{label}</Text>
        <Text style={s.valueText}>{formatDisplay(value, mode)}</Text>
      </Pressable>
    );
  }

  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <View style={s.iosField}>
        <DateTimePicker
          value={value}
          mode={mode}
          display="compact"
          minimumDate={minimumDate}
          themeVariant="dark"
          onChange={(_event, selected) => {
            if (selected) onChange(selected);
          }}
        />
      </View>
    </View>
  );
}

const webInputStyle: any = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.line}`,
  borderRadius: 12,
  color: colors.ink,
  padding: 14,
  fontSize: 16,
  fontFamily: "inherit",
  width: "100%",
  colorScheme: "dark",
};

const s = StyleSheet.create({
  label: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 7,
  },
  androidField: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
  },
  valueText: { color: colors.ink, fontSize: 16 },
  iosField: { alignItems: "flex-start" },
});
