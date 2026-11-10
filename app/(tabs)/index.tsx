import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  cancelLocalNotification,
  formatDateInput,
  isValidTime,
  parseDateInput,
  scheduleEventAlarm,
} from "@/lib/notifications";
import {
  loadEvents,
  saveEvents,
  type EventStatus,
  type SeegsonEvent,
} from "@/lib/seegson-storage";
import { colors, radii } from "@/lib/seegson-theme";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const CATEGORIES = ["Personal", "Trabajo", "Familia", "Salud", "Otro"];
const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: "Programado",
  completed: "Completado",
  cancelled: "Cancelado",
};

function toLocalIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthTitle(date: Date): string {
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function dateTitle(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function dateIsToday(isoDate: string): boolean {
  return isoDate === toLocalIsoDate();
}

function formatLongDate(date = new Date()): string {
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function CalendarGrid({
  currentMonth,
  selectedDate,
  eventDates,
  onSelect,
}: {
  currentMonth: Date;
  selectedDate: string;
  eventDates: Set<string>;
  onSelect: (date: string) => void;
}) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const mondayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: mondayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day, index) => (
          <Text key={`${day}-${index}`} style={styles.weekdayLabel}>
            {day}
          </Text>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((day, index) => {
          if (day === null) return <View key={`blank-${index}`} style={styles.dayCell} />;
          const dayDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const selected = dayDate === selectedDate;
          const hasEvent = eventDates.has(dayDate);
          const today = dayDate === toLocalIsoDate();
          return (
            <Pressable
              key={dayDate}
              onPress={() => onSelect(dayDate)}
              style={styles.dayCell}
              accessibilityRole="button"
              accessibilityLabel={`${day} de ${monthTitle(currentMonth)}${hasEvent ? ", tiene eventos" : ""}`}
            >
              <View
                style={[
                  styles.dayNumberWrap,
                  selected && styles.dayNumberSelected,
                  today && !selected && styles.dayNumberToday,
                ]}
              >
                <Text style={[styles.dayNumber, selected && styles.dayNumberSelectedText]}>{day}</Text>
              </View>
              <View style={[styles.dayDot, hasEvent && styles.dayDotActive, selected && hasEvent && styles.dayDotSelected]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EventCard({
  event,
  showDate,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  event: SeegsonEvent;
  showDate: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const completed = event.status === "completed";
  const cancelled = event.status === "cancelled";
  return (
    <View style={[styles.eventCard, cancelled && styles.eventCardMuted]}>
      <View style={styles.eventTimeColumn}>
        <Text style={[styles.eventTime, cancelled && styles.textMuted]}>{event.time}</Text>
        <View style={styles.eventTimelineLine} />
      </View>
      <View style={styles.eventBody}>
        <View style={styles.eventTopLine}>
          <View style={[styles.categoryDot, { backgroundColor: categoryColor(event.category) }]} />
          <Text style={styles.eventCategory}>{event.category || "General"}</Text>
          <View style={styles.eventActions}>
            <Pressable onPress={onToggleComplete} hitSlop={8} style={styles.iconButton} accessibilityLabel={completed ? "Marcar como pendiente" : "Marcar como completado"}>
              <Ionicons name={completed ? "checkmark-circle" : "checkmark-circle-outline"} size={19} color={completed ? colors.teal : colors.dim} />
            </Pressable>
            <Pressable onPress={onEdit} hitSlop={8} style={styles.iconButton} accessibilityLabel="Editar evento">
              <Ionicons name="create-outline" size={18} color={colors.muted} />
            </Pressable>
            <Pressable onPress={onDelete} hitSlop={8} style={styles.iconButton} accessibilityLabel="Eliminar evento">
              <Ionicons name="trash-outline" size={17} color={colors.dim} />
            </Pressable>
          </View>
        </View>
        <Text style={[styles.eventTitle, (completed || cancelled) && styles.textMuted]}>{event.title}</Text>
        {showDate && <Text style={{ color: colors.dim, fontSize: 9, marginTop: 3 }}>{dateTitle(event.date)}</Text>}
        {!!event.description && <Text style={styles.eventDescription} numberOfLines={2}>{event.description}</Text>}
        <View style={styles.eventMetaRow}>
          <View style={styles.metaItem}>
            <Ionicons name={event.alarmEnabled ? "notifications" : "notifications-off-outline"} size={13} color={event.alarmEnabled ? colors.amber : colors.dim} />
            <Text style={styles.metaText}>{event.alarmEnabled ? `Alarma ${event.alarmTime}` : "Sin alarma"}</Text>
          </View>
          {(completed || cancelled) && (
            <View style={[styles.statusPill, completed ? styles.statusDone : styles.statusCancelled]}>
              <Text style={[styles.statusText, completed ? styles.statusDoneText : styles.statusCancelledText]}>{STATUS_LABEL[event.status]}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function categoryColor(category: string): string {
  const colorsByCategory: Record<string, string> = {
    Personal: colors.amber,
    Trabajo: "#86A9FA",
    Familia: "#E7A4C0",
    Salud: colors.teal,
    Otro: "#B9A3F4",
  };
  return colorsByCategory[category] ?? colors.amber;
}

export default function CalendarScreen() {
  const today = toLocalIsoDate();
  const [events, setEvents] = useState<SeegsonEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [currentMonth, setCurrentMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [statusFilter, setStatusFilter] = useState<"all" | EventStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState<SeegsonEvent | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState(formatDateInput(today));
  const [formTime, setFormTime] = useState("16:00");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("Personal");
  const [formStatus, setFormStatus] = useState<EventStatus>("upcoming");
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [alarmTime, setAlarmTime] = useState("00:00");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadEvents().then((saved) => {
        if (active) setEvents(saved.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const eventDates = useMemo(() => new Set(events.map((event) => event.date)), [events]);
  const eventCategories = useMemo(
    () => [...new Set(events.map((event) => event.category).filter(Boolean))].sort(),
    [events],
  );
  const dayEvents = useMemo(
    () => {
      const searchTerm = search.trim().toLowerCase();
      return events
        .filter((event) => searchTerm.length > 0 || event.date === selectedDate)
        .filter((event) => statusFilter === "all" || event.status === statusFilter)
        .filter((event) => !categoryFilter || event.category === categoryFilter)
        .filter((event) => `${event.title} ${event.description} ${event.category}`.toLowerCase().includes(searchTerm))
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    },
    [events, selectedDate, statusFilter, categoryFilter, search],
  );

  const openNewEvent = () => {
    setEditingEvent(null);
    setFormTitle("");
    setFormDate(formatDateInput(selectedDate));
    setFormTime("16:00");
    setFormDescription("");
    setFormCategory("Personal");
    setFormStatus("upcoming");
    setAlarmEnabled(true);
    setAlarmTime("00:00");
    setFormError("");
    setModalVisible(true);
  };

  const openEditEvent = (event: SeegsonEvent) => {
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDate(formatDateInput(event.date));
    setFormTime(event.time);
    setFormDescription(event.description);
    setFormCategory(event.category || "Otro");
    setFormStatus(event.status);
    setAlarmEnabled(event.alarmEnabled);
    setAlarmTime(event.alarmTime);
    setFormError("");
    setModalVisible(true);
  };

  const persistEvents = async (nextEvents: SeegsonEvent[]) => {
    const sorted = [...nextEvents].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    await saveEvents(sorted);
    setEvents(sorted);
  };

  const saveEvent = async () => {
    setFormError("");
    const isoDate = parseDateInput(formDate);
    if (!formTitle.trim()) return setFormError("Añade un título para el evento.");
    if (!isoDate) return setFormError("Usa una fecha válida en formato DD/MM/AAAA.");
    if (!isValidTime(formTime)) return setFormError("La hora debe tener el formato HH:MM.");
    if (alarmEnabled && !isValidTime(alarmTime)) return setFormError("La hora de alarma debe tener el formato HH:MM.");

    setSaving(true);
    try {
      if (editingEvent?.notificationId) await cancelLocalNotification(editingEvent.notificationId);
      const event: SeegsonEvent = {
        id: editingEvent?.id ?? makeId(),
        title: formTitle.trim(),
        date: isoDate,
        time: formTime,
        description: formDescription.trim(),
        category: formCategory.trim() || "Otro",
        status: formStatus,
        alarmEnabled: alarmEnabled && formStatus === "upcoming",
        alarmTime: alarmEnabled ? alarmTime : "00:00",
      };
      const notificationId = event.alarmEnabled
        ? await scheduleEventAlarm({
            eventId: event.id,
            title: event.title,
            date: event.date,
            time: event.time,
            alarmTime: event.alarmTime,
          })
        : null;
      const alarmRequested = event.alarmEnabled;
      event.notificationId = notificationId ?? undefined;
      if (alarmRequested && !notificationId) event.alarmEnabled = false;
      await persistEvents(editingEvent ? events.map((item) => item.id === event.id ? event : item) : [...events, event]);
      setSelectedDate(isoDate);
      setCurrentMonth(new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, 1));
      setModalVisible(false);
      if (alarmRequested && !notificationId) {
        const message = "No se pudo programar la alarma. Comprueba los permisos de notificación y que la hora elegida aún no haya pasado.";
        if (Platform.OS === "web" && typeof window !== "undefined") window.alert(`Evento guardado\n\n${message}`);
        else Alert.alert("Evento guardado", message);
      }
    } catch {
      setFormError("No se pudo guardar el evento. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = (event: SeegsonEvent) => {
    const remove = async () => {
      try {
        await cancelLocalNotification(event.notificationId);
        await persistEvents(events.filter((item) => item.id !== event.id));
      } catch {
        const message = "No se pudo eliminar el evento. Inténtalo de nuevo.";
        if (Platform.OS === "web" && typeof window !== "undefined") window.alert(message);
        else Alert.alert("No se pudo eliminar", message);
      }
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`¿Eliminar “${event.title}”?`)) void remove();
    } else {
      Alert.alert("Eliminar evento", `¿Quieres eliminar “${event.title}”?`, [
        { text: "Conservar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => void remove() },
      ]);
    }
  };

  const toggleComplete = async (event: SeegsonEvent) => {
    try {
      const nextStatus: EventStatus = event.status === "completed" ? "upcoming" : "completed";
      if (nextStatus === "completed") await cancelLocalNotification(event.notificationId);
      const updated: SeegsonEvent = { ...event, status: nextStatus, notificationId: undefined };
      if (nextStatus === "upcoming" && event.alarmEnabled) {
        updated.notificationId = (await scheduleEventAlarm({
          eventId: event.id,
          title: event.title,
          date: event.date,
          time: event.time,
          alarmTime: event.alarmTime,
        })) ?? undefined;
        if (!updated.notificationId) {
          updated.alarmEnabled = false;
          const message = "El evento volvió a pendientes, pero quedó sin alarma porque Android no pudo programarla.";
          if (Platform.OS === "web" && typeof window !== "undefined") window.alert(message);
          else Alert.alert("Alarma pausada", message);
        }
      }
      await persistEvents(events.map((item) => item.id === event.id ? updated : item));
    } catch {
      const message = "No se pudo actualizar el estado del evento.";
      if (Platform.OS === "web" && typeof window !== "undefined") window.alert(message);
      else Alert.alert("No se pudo actualizar", message);
    }
  };

  const moveMonth = (amount: number) => {
    const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + amount, 1);
    setCurrentMonth(next);
    const newDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
    setSelectedDate(newDate);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Ionicons name="time-outline" size={20} color={colors.background} />
          </View>
          <View>
            <Text style={styles.brandName}>SEEGSON</Text>
            <Text style={styles.brandSubtitle}>GESTOR DE EVENTOS</Text>
          </View>
          <View style={styles.headerDatePill}>
            <View style={styles.liveDot} />
            <Text style={styles.headerDateText}>EN ORDEN</Text>
          </View>
        </View>

        <View style={styles.introBlock}>
          <Text style={styles.eyebrow}>{dateIsToday(selectedDate) ? "HOY EN TU AGENDA" : "DÍA SELECCIONADO"}</Text>
          <Text style={styles.pageTitle}>Tu tiempo,{"\n"}<Text style={styles.pageTitleAccent}>bien marcado.</Text></Text>
          <Text style={styles.dateCaption}>{dateIsToday(selectedDate) ? formatLongDate() : dateTitle(selectedDate)}</Text>
        </View>

        <View style={styles.calendarCard}>
          <View style={styles.monthHeader}>
            <View>
              <Text style={styles.monthTitle}>{monthTitle(currentMonth)}</Text>
              <Text style={styles.calendarHint}>Toca un día para ver su agenda</Text>
            </View>
            <View style={styles.monthActions}>
              <Pressable style={styles.monthButton} onPress={() => moveMonth(-1)} accessibilityLabel="Mes anterior">
                <Ionicons name="chevron-back" size={18} color={colors.text} />
              </Pressable>
              <Pressable style={styles.monthButton} onPress={() => moveMonth(1)} accessibilityLabel="Mes siguiente">
                <Ionicons name="chevron-forward" size={18} color={colors.text} />
              </Pressable>
            </View>
          </View>
          <CalendarGrid
            currentMonth={currentMonth}
            selectedDate={selectedDate}
            eventDates={eventDates}
            onSelect={setSelectedDate}
          />
          <View style={styles.calendarLegend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.teal }]} /><Text style={styles.legendText}>Con eventos</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.amber }]} /><Text style={styles.legendText}>Seleccionado</Text></View>
          </View>
        </View>

        <View style={styles.agendaHeader}>
          <View>
            <Text style={styles.sectionEyebrow}>TU AGENDA</Text>
            <Text style={styles.sectionTitle}>{search.trim() ? "Resultados de búsqueda" : dateIsToday(selectedDate) ? "Lo que viene hoy" : dateTitle(selectedDate)}</Text>
          </View>
          <Pressable style={styles.addButton} onPress={openNewEvent}>
            <Ionicons name="add" size={19} color={colors.background} />
            <Text style={styles.addButtonText}>Nuevo</Text>
          </Pressable>
        </View>

        <View style={styles.filterBar}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={17} color={colors.dim} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar en toda la agenda"
              placeholderTextColor={colors.dim}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {!!search && <Pressable onPress={() => setSearch("")}><Ionicons name="close-circle" size={17} color={colors.dim} /></Pressable>}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
            {[{ label: "Todos", value: "all" as const }, { label: "Pendientes", value: "upcoming" as const }, { label: "Hechos", value: "completed" as const }, { label: "Cancelados", value: "cancelled" as const }].map((filter) => (
              <Pressable key={filter.value} onPress={() => setStatusFilter(filter.value)} style={[styles.filterChip, statusFilter === filter.value && styles.filterChipSelected]}>
                <Text style={[styles.filterChipText, statusFilter === filter.value && styles.filterChipTextSelected]}>{filter.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {eventCategories.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryFilters}>
            <Pressable onPress={() => setCategoryFilter(null)} style={[styles.categoryFilterChip, !categoryFilter && styles.categoryFilterSelected]}>
              <Text style={[styles.categoryFilterText, !categoryFilter && styles.categoryFilterTextSelected]}>Todas las categorías</Text>
            </Pressable>
            {eventCategories.map((category) => (
              <Pressable key={category} onPress={() => setCategoryFilter(categoryFilter === category ? null : category)} style={[styles.categoryFilterChip, categoryFilter === category && styles.categoryFilterSelected]}>
                <View style={[styles.categoryDotSmall, { backgroundColor: categoryColor(category) }]} />
                <Text style={[styles.categoryFilterText, categoryFilter === category && styles.categoryFilterTextSelected]}>{category}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {dayEvents.length > 0 ? (
          <View style={styles.eventList}>
            {dayEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                showDate={search.trim().length > 0}
                onEdit={() => openEditEvent(event)}
                onDelete={() => deleteEvent(event)}
                onToggleComplete={() => void toggleComplete(event)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Ionicons name="calendar-clear-outline" size={25} color={colors.teal} /></View>
            <Text style={styles.emptyTitle}>{events.length === 0 ? "Un espacio para lo importante" : "Día despejado"}</Text>
            <Text style={styles.emptyBody}>{events.length === 0 ? "Añade tu primer evento y decide cuándo quieres recibir el aviso." : search.trim() ? "No hay eventos que coincidan con la búsqueda y estos filtros." : "No hay eventos que coincidan con esta fecha y estos filtros."}</Text>
            {events.length === 0 && <Pressable onPress={openNewEvent} style={styles.emptyAction}><Text style={styles.emptyActionText}>Crear primer evento</Text><Ionicons name="arrow-forward" size={16} color={colors.amber} /></Pressable>}
          </View>
        )}
        <View style={{ height: 28 }} />
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>{editingEvent ? "AJUSTAR EVENTO" : "NUEVO EN TU AGENDA"}</Text>
                <Text style={styles.modalTitle}>{editingEvent ? "Editar evento" : "Crear evento"}</Text>
              </View>
              <Pressable onPress={() => setModalVisible(false)} style={styles.modalClose} accessibilityLabel="Cerrar">
                <Ionicons name="close" size={21} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>TÍTULO</Text>
              <TextInput value={formTitle} onChangeText={setFormTitle} placeholder="¿Qué tienes en mente?" placeholderTextColor={colors.dim} style={styles.input} maxLength={120} autoFocus />

              <View style={styles.twoFields}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>FECHA · DD/MM/AAAA</Text>
                  <TextInput value={formDate} onChangeText={setFormDate} placeholder="28/12/2026" placeholderTextColor={colors.dim} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={10} />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>HORA</Text>
                  <TextInput value={formTime} onChangeText={setFormTime} placeholder="16:00" placeholderTextColor={colors.dim} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={5} />
                </View>
              </View>

              <Text style={styles.fieldLabel}>CATEGORÍA</Text>
              <View style={styles.categoryPickRow}>
                {CATEGORIES.map((category) => (
                  <Pressable key={category} onPress={() => setFormCategory(category)} style={[styles.categoryPick, formCategory === category && styles.categoryPickActive]}>
                    <View style={[styles.categoryDotSmall, { backgroundColor: categoryColor(category) }]} />
                    <Text style={[styles.categoryPickText, formCategory === category && styles.categoryPickTextActive]}>{category}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>DESCRIPCIÓN</Text>
              <TextInput value={formDescription} onChangeText={setFormDescription} placeholder="Detalles que quieras recordar…" placeholderTextColor={colors.dim} style={[styles.input, styles.multilineInput]} multiline numberOfLines={3} maxLength={500} />

              <View style={styles.alarmConfigCard}>
                <View style={styles.alarmConfigTop}>
                  <View style={styles.alarmIcon}><Ionicons name="alarm-outline" size={20} color={colors.amber} /></View>
                  <View style={styles.alarmCopy}>
                    <Text style={styles.alarmTitle}>Alarma del evento</Text>
                    <Text style={styles.alarmSubtitle}>Suena el mismo día del evento</Text>
                  </View>
                  <Switch
                    value={alarmEnabled}
                    onValueChange={setAlarmEnabled}
                    trackColor={{ false: colors.surfaceSoft, true: colors.amberSoft }}
                    thumbColor={alarmEnabled ? colors.amber : colors.muted}
                  />
                </View>
                {alarmEnabled && (
                  <View style={styles.alarmTimeRow}>
                    <Text style={styles.alarmTimeLabel}>Hora del aviso</Text>
                    <TextInput value={alarmTime} onChangeText={setAlarmTime} placeholder="00:00" placeholderTextColor={colors.dim} style={styles.timeInput} keyboardType="numbers-and-punctuation" maxLength={5} />
                  </View>
                )}
                {alarmEnabled && Platform.OS === "android" && (
                  <Pressable onPress={() => void Linking.openSettings()} style={{ paddingTop: 8 }}>
                    <Text style={{ color: colors.teal, fontSize: 9, fontWeight: "700" }}>Si Android lo solicita, permite Notificaciones y «Alarmas y recordatorios» en Ajustes.</Text>
                  </Pressable>
                )}
                {alarmEnabled && Platform.OS === "web" && (
                  <Text style={{ color: colors.dim, fontSize: 9, lineHeight: 13, marginTop: 7 }}>La vista previa web guarda la alarma, pero solo la app Android puede reproducirla.</Text>
                )}
              </View>

              <Text style={styles.fieldLabel}>ESTADO</Text>
              <View style={styles.statusOptions}>
                {(["upcoming", "completed", "cancelled"] as EventStatus[]).map((status) => (
                  <Pressable key={status} onPress={() => setFormStatus(status)} style={[styles.statusOption, formStatus === status && styles.statusOptionActive]}>
                    <Text style={[styles.statusOptionText, formStatus === status && styles.statusOptionTextActive]}>{STATUS_LABEL[status]}</Text>
                  </Pressable>
                ))}
              </View>

              {!!formError && <Text style={styles.formError}>{formError}</Text>}
              <Pressable onPress={() => void saveEvent()} disabled={saving} style={[styles.saveButton, saving && { opacity: 0.65 }]}>
                <Text style={styles.saveButtonText}>{saving ? "Guardando…" : editingEvent ? "Guardar cambios" : "Guardar evento"}</Text>
                {!saving && <Ionicons name="arrow-forward" size={17} color={colors.background} />}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, maxWidth: 640, width: "100%", alignSelf: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  brandName: { color: colors.text, fontSize: 13, fontWeight: "900", letterSpacing: 2.3 },
  brandSubtitle: { color: colors.dim, fontSize: 8, fontWeight: "700", letterSpacing: 1.4, marginTop: 3 },
  headerDatePill: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 4, backgroundColor: colors.teal },
  headerDateText: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  introBlock: { marginTop: 27, marginBottom: 19 },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: "800", letterSpacing: 1.8, marginBottom: 8 },
  pageTitle: { color: colors.text, fontSize: 31, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6 },
  pageTitleAccent: { color: colors.amber },
  dateCaption: { color: colors.muted, fontSize: 13, marginTop: 8, textTransform: "capitalize" },
  calendarCard: { backgroundColor: colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, padding: 17 },
  monthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  monthTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  calendarHint: { color: colors.dim, fontSize: 11, marginTop: 3 },
  monthActions: { flexDirection: "row", gap: 7 },
  monthButton: { width: 33, height: 33, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  weekdayRow: { flexDirection: "row", marginBottom: 4 },
  weekdayLabel: { width: `${100 / 7}%`, textAlign: "center", color: colors.dim, fontSize: 10, fontWeight: "800", paddingVertical: 7 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, height: 42, alignItems: "center", justifyContent: "center" },
  dayNumberWrap: { width: 31, height: 31, alignItems: "center", justifyContent: "center", borderRadius: 11 },
  dayNumberSelected: { backgroundColor: colors.amber },
  dayNumberToday: { borderWidth: 1, borderColor: colors.amber },
  dayNumber: { color: colors.text, fontSize: 12, fontWeight: "600" },
  dayNumberSelectedText: { color: colors.background, fontWeight: "900" },
  dayDot: { width: 4, height: 4, borderRadius: 3, marginTop: -1 },
  dayDotActive: { backgroundColor: colors.teal },
  dayDotSelected: { backgroundColor: colors.background },
  calendarLegend: { flexDirection: "row", gap: 17, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 6, height: 6, borderRadius: 4 },
  legendText: { color: colors.dim, fontSize: 10 },
  agendaHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 29, marginBottom: 14 },
  sectionEyebrow: { color: colors.teal, fontSize: 9, fontWeight: "900", letterSpacing: 1.8, marginBottom: 5 },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "800", textTransform: "capitalize" },
  addButton: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.amber, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 10 },
  addButtonText: { color: colors.background, fontSize: 12, fontWeight: "800" },
  filterBar: { gap: 11, marginBottom: 7 },
  searchBox: { height: 43, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: colors.text, fontSize: 12, paddingVertical: 0 },
  filterChips: { gap: 7, paddingRight: 10 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipSelected: { backgroundColor: colors.amberSoft, borderColor: "#70572E" },
  filterChipText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  filterChipTextSelected: { color: colors.amber },
  categoryFilters: { gap: 7, paddingVertical: 9 },
  categoryFilterChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  categoryFilterSelected: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  categoryFilterText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  categoryFilterTextSelected: { color: colors.teal },
  categoryDotSmall: { width: 6, height: 6, borderRadius: 4 },
  eventList: { marginTop: 6, gap: 9 },
  eventCard: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 14, minHeight: 101 },
  eventCardMuted: { opacity: 0.63 },
  eventTimeColumn: { width: 47, alignItems: "flex-start" },
  eventTime: { color: colors.amber, fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  eventTimelineLine: { width: 1, flex: 1, backgroundColor: colors.border, marginLeft: 7, marginTop: 9 },
  eventBody: { flex: 1 },
  eventTopLine: { flexDirection: "row", alignItems: "center", minHeight: 18 },
  categoryDot: { width: 6, height: 6, borderRadius: 4, marginRight: 6 },
  eventCategory: { color: colors.muted, fontSize: 9, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  eventActions: { flexDirection: "row", gap: 1, marginLeft: "auto" },
  iconButton: { width: 27, height: 24, alignItems: "center", justifyContent: "center" },
  eventTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 5 },
  eventDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.dim, fontSize: 10 },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3 },
  statusDone: { backgroundColor: colors.tealSoft },
  statusCancelled: { backgroundColor: colors.redSoft },
  statusText: { fontSize: 9, fontWeight: "700" },
  statusDoneText: { color: colors.teal },
  statusCancelledText: { color: colors.red },
  textMuted: { color: colors.dim },
  emptyState: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", paddingHorizontal: 23, paddingVertical: 24, marginTop: 10 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800", textAlign: "center" },
  emptyBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6, maxWidth: 290 },
  emptyAction: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 10, marginTop: 7 },
  emptyActionText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.54)" },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalSheet: { maxHeight: "93%", backgroundColor: colors.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Platform.OS === "web" ? 22 : 28 },
  modalHandle: { width: 40, height: 4, borderRadius: 4, backgroundColor: colors.dim, alignSelf: "center", marginBottom: 17 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 17 },
  modalTitle: { color: colors.text, fontSize: 21, fontWeight: "800" },
  modalClose: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  formContent: { gap: 8, paddingBottom: 10 },
  fieldLabel: { color: colors.dim, fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginTop: 9, marginBottom: 1 },
  input: { minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.input, color: colors.text, paddingHorizontal: 13, fontSize: 13 },
  multilineInput: { minHeight: 82, textAlignVertical: "top", paddingTop: 12 },
  twoFields: { flexDirection: "row", gap: 10 },
  fieldHalf: { flex: 1 },
  categoryPickRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  categoryPick: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  categoryPickActive: { borderColor: colors.amber, backgroundColor: colors.amberSoft },
  categoryPickText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  categoryPickTextActive: { color: colors.amber },
  alarmConfigCard: { borderRadius: 16, borderWidth: 1, borderColor: "#5B472A", backgroundColor: "#201B14", paddingHorizontal: 13, paddingVertical: 12, marginTop: 7 },
  alarmConfigTop: { flexDirection: "row", alignItems: "center" },
  alarmIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center" },
  alarmCopy: { flex: 1, marginLeft: 10 },
  alarmTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  alarmSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  alarmTimeRow: { borderTopWidth: 1, borderTopColor: "#3D3426", marginTop: 12, paddingTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  alarmTimeLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  timeInput: { color: colors.amber, fontSize: 16, fontWeight: "900", letterSpacing: 1, minWidth: 74, textAlign: "center", backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  statusOptions: { flexDirection: "row", gap: 7 },
  statusOption: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statusOptionActive: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  statusOptionText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  statusOptionTextActive: { color: colors.teal },
  formError: { color: colors.red, fontSize: 11, lineHeight: 16, marginTop: 5 },
  saveButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 15, backgroundColor: colors.amber, marginTop: 14 },
  saveButtonText: { color: colors.background, fontSize: 13, fontWeight: "900" },
});
