import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { Text, useI18n } from "../i18n";
import { summarizeReadingStats, type ReadingStats } from "../services/readingStats";
import type { Book } from "../types";
import { IOSPopupModal } from "./IOSPopupModal";

type Props = {
  books: Book[];
  onClose: () => void;
  stats: ReadingStats;
  visible: boolean;
};

function formatDuration(durationMs: number, english: boolean) {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) return english ? "Less than a minute" : "片刻";
  if (minutes < 60) return english ? `${minutes} min` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!remaining) return english ? `${hours} hr` : `${hours} 小时`;
  return english ? `${hours} hr ${remaining} min` : `${hours} 小时 ${remaining} 分`;
}

export function ReadingInsightsModal({ books, onClose, stats, visible }: Props) {
  const { resolvedLanguage } = useI18n();
  const english = resolvedLanguage === "en";
  const summary = useMemo(() => summarizeReadingStats(stats), [stats]);
  const bookMap = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const topBooks = useMemo(
    () => Object.entries(stats.books)
      .sort(([, left], [, right]) => right.durationMs - left.durationMs)
      .slice(0, 3)
      .map(([bookId, record]) => ({ bookId, record, book: bookMap.get(bookId) }))
      .filter((item) => item.book),
    [bookMap, stats.books],
  );
  const maxDay = Math.max(60_000, ...summary.week.map((day) => day.durationMs));
  const today = summary.week[summary.week.length - 1]?.date;

  return (
    <IOSPopupModal onRequestClose={onClose} visible={visible}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.card}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons color="#F5E4C8" name="footsteps-outline" size={23} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>READING TRACE</Text>
            <Text style={styles.title}>阅读足迹</Text>
            <Text style={styles.subtitle}>翻过的页，慢慢长成自己的年轮</Text>
          </View>
          <Pressable accessibilityLabel="关闭阅读足迹" onPress={onClose} style={styles.close}>
            <Ionicons color="#526158" name="close" size={19} />
          </Pressable>
        </View>

        <View style={styles.heroRow}>
          <Animated.View entering={FadeInUp.delay(30).duration(280)} style={styles.heroPrimary}>
            <Text style={styles.heroLabel}>今日共读</Text>
            <Text style={styles.heroValue}>{formatDuration(summary.todayMs, english)}</Text>
            <Text style={styles.heroNote}>安静地留在本机</Text>
          </Animated.View>
          <View style={styles.heroSide}>
            <Animated.View entering={FadeInUp.delay(70).duration(280)} style={styles.miniCard}>
              <Text style={styles.miniValue}>{summary.streak}</Text>
              <Text style={styles.miniLabel}>连续阅读天数</Text>
            </Animated.View>
            <Animated.View entering={FadeInUp.delay(100).duration(280)} style={styles.miniCard}>
              <Text style={styles.miniValue}>{summary.pagesTurned}</Text>
              <Text style={styles.miniLabel}>翻过的页</Text>
            </Animated.View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>最近七日</Text>
          <Text style={styles.sectionMeta}>{formatDuration(summary.weekMs, english)}</Text>
        </View>
        <View style={styles.chart}>
          {summary.week.map((day, index) => {
            const date = new Date(`${day.date}T12:00:00`);
            const ratio = day.durationMs / maxDay;
            const isToday = day.date === today;
            return (
              <View key={day.date} style={styles.chartColumn}>
                <View style={styles.barTrack}>
                  <Animated.View
                    entering={FadeInUp.delay(120 + index * 35).duration(260)}
                    style={[
                      styles.bar,
                      isToday && styles.barToday,
                      { height: day.durationMs ? `${Math.max(12, ratio * 100)}%` : 3 },
                    ]}
                  />
                </View>
                <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                  {english
                    ? ["S", "M", "T", "W", "T", "F", "S"][date.getDay()]
                    : ["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>常伴书页</Text>
          <Text style={styles.sectionMeta}>累计 {formatDuration(summary.totalMs, english)}</Text>
        </View>
        {topBooks.length ? (
          <View style={styles.bookList}>
            {topBooks.map((item, index) => (
              <Animated.View
                entering={FadeInUp.delay(150 + index * 45).duration(280)}
                key={item.bookId}
                style={[styles.bookRow, index === topBooks.length - 1 && styles.bookRowLast]}
              >
                <View style={styles.bookRank}><Text style={styles.bookRankText}>{index + 1}</Text></View>
                <View style={styles.bookCopy}>
                  <Text numberOfLines={1} style={styles.bookTitle}>{item.book?.title}</Text>
                  <Text numberOfLines={1} style={styles.bookAuthor}>{item.book?.author}</Text>
                </View>
                <Text style={styles.bookTime}>{formatDuration(item.record.durationMs, english)}</Text>
              </Animated.View>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Ionicons color="#A2AAA4" name="leaf-outline" size={24} />
            <Text style={styles.emptyText}>读上一会儿，足迹便会在这里生长</Text>
          </View>
        )}
      </ScrollView>
    </IOSPopupModal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F9F6EF",
    borderColor: "#FFFFFFA8",
    borderRadius: 28,
    borderWidth: 1,
    elevation: 20,
    maxHeight: "88%",
    maxWidth: 520,
    width: "100%",
  },
  content: { padding: 21, paddingBottom: 24 },
  header: { alignItems: "center", flexDirection: "row" },
  headerIcon: { alignItems: "center", backgroundColor: "#365847", borderRadius: 18, height: 52, justifyContent: "center", width: 52 },
  headerCopy: { flex: 1, marginLeft: 12 },
  eyebrow: { color: "#7A8F83", fontSize: 7.5, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: "#303932", fontFamily: "serif", fontSize: 22, fontWeight: "900", marginTop: 1 },
  subtitle: { color: "#95958E", fontSize: 9.5, marginTop: 3 },
  close: { alignItems: "center", backgroundColor: "#E8EAE5", borderRadius: 14, height: 38, justifyContent: "center", width: 38 },
  heroRow: { flexDirection: "row", gap: 10, marginTop: 19 },
  heroPrimary: { backgroundColor: "#3B5C4B", borderRadius: 21, flex: 1.3, minHeight: 132, padding: 17 },
  heroLabel: { color: "#D8E3DC", fontSize: 10, fontWeight: "700" },
  heroValue: { color: "#FFF4E2", fontFamily: "serif", fontSize: 24, fontWeight: "900", marginTop: 12 },
  heroNote: { color: "#FFFFFF86", fontSize: 8.5, marginTop: "auto" },
  heroSide: { flex: 1, gap: 8 },
  miniCard: { backgroundColor: "#ECEDE7", borderColor: "#D8DAD3", borderRadius: 17, borderWidth: 1, flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  miniValue: { color: "#3E594B", fontFamily: "serif", fontSize: 20, fontWeight: "900" },
  miniLabel: { color: "#888E89", fontSize: 8.5, marginTop: 2 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 20 },
  sectionTitle: { color: "#3B443E", fontSize: 13, fontWeight: "900" },
  sectionMeta: { color: "#8A918C", fontSize: 9.5 },
  chart: { alignItems: "flex-end", backgroundColor: "#EFEDE6", borderRadius: 19, flexDirection: "row", height: 142, paddingBottom: 12, paddingHorizontal: 12, paddingTop: 15 },
  chartColumn: { alignItems: "center", flex: 1, height: "100%" },
  barTrack: { flex: 1, justifyContent: "flex-end", width: 11 },
  bar: { backgroundColor: "#AEBDB4", borderRadius: 6, minHeight: 3, width: 11 },
  barToday: { backgroundColor: "#416551" },
  dayLabel: { color: "#92958F", fontSize: 8.5, marginTop: 7 },
  dayLabelToday: { color: "#416551", fontWeight: "900" },
  bookList: { backgroundColor: "#F0EEE8", borderRadius: 19, paddingHorizontal: 14 },
  bookRow: { alignItems: "center", borderBottomColor: "#DBDAD4", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", minHeight: 61 },
  bookRowLast: { borderBottomWidth: 0 },
  bookRank: { alignItems: "center", backgroundColor: "#DEE6DF", borderRadius: 11, height: 30, justifyContent: "center", width: 30 },
  bookRankText: { color: "#4B6959", fontFamily: "serif", fontSize: 12, fontWeight: "900" },
  bookCopy: { flex: 1, marginLeft: 10, minWidth: 0 },
  bookTitle: { color: "#3B433E", fontSize: 11.5, fontWeight: "800" },
  bookAuthor: { color: "#989A95", fontSize: 8.5, marginTop: 3 },
  bookTime: { color: "#607269", fontSize: 9.5, fontWeight: "700", marginLeft: 8 },
  empty: { alignItems: "center", backgroundColor: "#F0EEE8", borderRadius: 19, minHeight: 92, justifyContent: "center" },
  emptyText: { color: "#979A95", fontSize: 9.5, marginTop: 6 },
});
