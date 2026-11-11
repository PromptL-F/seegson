import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  KeyboardAvoidingView,
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

import { useAuth } from "@/hooks/use-auth";
import { startOAuthLogin } from "@/constants/oauth";
import {
  cancelLocalNotification,
  isValidTime,
  scheduleReminder,
  scheduleEventAlarm,
} from "@/lib/notifications";
import {
  loadDailyTasks,
  loadEvents,
  saveDailyTasks,
  saveEvents,
  type DailyReminderTask,
  type SeegsonEvent,
} from "@/lib/seegson-storage";
import { SeegsonLogo } from "@/components/seegson-logo";
import { colors, radii } from "@/lib/seegson-theme";
import { trpc } from "@/lib/trpc";
import { describeSchedule } from "@/shared/agent-actions";

type RemoteArchTask = {
  id: number;
  title: string;
  kind: "arch_news";
  localTime: string;
  timeZone: string;
  isEnabled: boolean;
};
type Editable =
  | { kind: "event"; value: SeegsonEvent }
  | { kind: "daily"; value: DailyReminderTask }
  | { kind: "arch"; value: RemoteArchTask };

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatEventDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

function formatAlertDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AlertsScreen() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<SeegsonEvent[]>([]);
  const [dailyTasks, setDailyTasks] = useState<DailyReminderTask[]>([]);
  const [editing, setEditing] = useState<Editable | null>(null);
  const [formTime, setFormTime] = useState("00:00");
  const [formTitle, setFormTitle] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const utils = trpc.useUtils();
  const tasksQuery = trpc.agent.tasks.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const alertsQuery = trpc.agent.alerts.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const updateMonitor = trpc.agent.updateArchMonitor.useMutation();
  const deleteMonitor = trpc.agent.deleteArchMonitor.useMutation();

  const remoteTasks = useMemo(() => (tasksQuery.data ?? []) as unknown as RemoteArchTask[], [tasksQuery.data]);
  const recentEvents = useMemo(
    () => events.filter((event) => event.date >= todayIso() && event.status === "upcoming").sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [events],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([loadEvents(), loadDailyTasks()]).then(([savedEvents, savedTasks]) => {
        if (active) {
          setEvents(savedEvents);
          setDailyTasks(savedTasks);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const openEditor = (value: Editable) => {
    setEditing(value);
    setFormError("");
    if (value.kind === "event") {
      setFormTitle(value.value.title);
      setFormTime(value.value.alarmTime);
      setFormEnabled(value.value.alarmEnabled);
    } else if (value.kind === "daily") {
      setFormTitle(value.value.title);
      setFormTime(value.value.time);
      setFormEnabled(value.value.enabled);
    } else {
      setFormTitle(value.value.title);
      setFormTime(value.value.localTime);
      setFormEnabled(value.value.isEnabled);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setFormError("");
    setActionError("");
    if (!isValidTime(formTime)) return setFormError("Escribe la hora en formato HH:MM.");
    setSaving(true);
    let keepOpen = false;
    try {
      if (editing.kind === "event") {
        const oldEvent = editing.value;
        await cancelLocalNotification(oldEvent.notificationId);
        const nextEvent: SeegsonEvent = {
          ...oldEvent,
          alarmEnabled: formEnabled,
          alarmTime: formTime,
          notificationId: undefined,
        };
        if (formEnabled) {
          nextEvent.notificationId = (await scheduleEventAlarm({
            eventId: oldEvent.id,
            title: oldEvent.title,
            date: oldEvent.date,
            time: oldEvent.time,
            alarmTime: formTime,
          })) ?? undefined;
          if (!nextEvent.notificationId) {
            nextEvent.alarmEnabled = false;
            setFormEnabled(false);
            keepOpen = true;
            setFormError("El evento se guardó con la alarma pausada. Revisa permisos de Android y que la hora no haya pasado.");
          }
        }
        const next = events.map((event) => event.id === oldEvent.id ? nextEvent : event);
        await saveEvents(next);
        setEvents(next);
      } else if (editing.kind === "daily") {
        const oldTask = editing.value;
        await cancelLocalNotification(oldTask.notificationId);
        const nextTask: DailyReminderTask = {
          ...oldTask,
          title: formTitle.trim() || oldTask.title,
          time: formTime,
          enabled: formEnabled,
          notificationId: undefined,
        };
        if (formEnabled) nextTask.notificationId = (await scheduleReminder({ taskId: oldTask.id, title: nextTask.title, time: formTime, repeat: nextTask.repeat, date: nextTask.date, weekday: nextTask.weekday })) ?? undefined;
        if (formEnabled && !nextTask.notificationId) {
          nextTask.enabled = false;
          setFormEnabled(false);
        }
        const next = dailyTasks.map((task) => task.id === oldTask.id ? nextTask : task);
        await saveDailyTasks(next);
        setDailyTasks(next);
        if (formEnabled && !nextTask.notificationId) {
          keepOpen = true;
          setFormError("El recordatorio se guardó pausado porque no se pudo programar. Comprueba los permisos de Android.");
        }
      } else {
        await updateMonitor.mutateAsync({ id: editing.value.id, time: formTime, enabled: formEnabled });
        await utils.agent.tasks.invalidate();
      }
      if (!keepOpen) setEditing(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo actualizar el aviso.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEvent = async (event: SeegsonEvent) => {
    setActionError("");
    try {
      const nextEnabled = !event.alarmEnabled;
      if (event.notificationId) await cancelLocalNotification(event.notificationId);
      const updated: SeegsonEvent = { ...event, alarmEnabled: nextEnabled, notificationId: undefined };
      if (nextEnabled) {
        updated.notificationId = (await scheduleEventAlarm({ eventId: event.id, title: event.title, date: event.date, time: event.time, alarmTime: event.alarmTime })) ?? undefined;
        if (!updated.notificationId) {
          updated.alarmEnabled = false;
          setActionError("La alarma quedó pausada. Revisa permisos de Android y que la hora aún no haya pasado.");
        }
      }
      const next = events.map((item) => item.id === event.id ? updated : item);
      await saveEvents(next);
      setEvents(next);
    } catch {
      setActionError("No se pudo cambiar la alarma del evento. Inténtalo de nuevo.");
    }
  };

  const toggleDaily = async (task: DailyReminderTask) => {
    setActionError("");
    try {
      const nextEnabled = !task.enabled;
      if (task.notificationId) await cancelLocalNotification(task.notificationId);
      const updated: DailyReminderTask = { ...task, enabled: nextEnabled, notificationId: undefined };
      if (nextEnabled) {
        updated.notificationId = (await scheduleReminder({ taskId: task.id, title: task.title, time: task.time, repeat: task.repeat, date: task.date, weekday: task.weekday })) ?? undefined;
        if (!updated.notificationId) {
          updated.enabled = false;
          setActionError("La rutina quedó pausada porque no se pudo programar. Revisa los permisos de Android.");
        }
      }
      const next = dailyTasks.map((item) => item.id === task.id ? updated : item);
      await saveDailyTasks(next);
      setDailyTasks(next);
    } catch {
      setActionError("No se pudo cambiar la rutina diaria. Inténtalo de nuevo.");
    }
  };

  const deleteLocalEventAlarm = async (event: SeegsonEvent) => {
    setActionError("");
    try {
      if (event.notificationId) await cancelLocalNotification(event.notificationId);
      const next = events.map((item) => item.id === event.id ? { ...item, alarmEnabled: false, notificationId: undefined } : item);
      await saveEvents(next);
      setEvents(next);
    } catch {
      setActionError("No se pudo desactivar la alarma del evento.");
    }
  };

  const deleteDaily = async (task: DailyReminderTask) => {
    setActionError("");
    try {
      if (task.notificationId) await cancelLocalNotification(task.notificationId);
      const next = dailyTasks.filter((item) => item.id !== task.id);
      await saveDailyTasks(next);
      setDailyTasks(next);
    } catch {
      setActionError("No se pudo eliminar la rutina diaria.");
    }
  };

  const toggleRemote = async (task: RemoteArchTask) => {
    setActionError("");
    try {
      await updateMonitor.mutateAsync({ id: task.id, enabled: !task.isEnabled });
      await utils.agent.tasks.invalidate();
    } catch {
      setActionError("No se pudo cambiar la vigilancia. Revisa la conexión e inténtalo de nuevo.");
      await utils.agent.tasks.invalidate();
    }
  };

  const confirmRemoveMonitor = (task: RemoteArchTask) => {
    const remove = async () => {
      setActionError("");
      try {
        await deleteMonitor.mutateAsync({ id: task.id });
        await utils.agent.tasks.invalidate();
      } catch {
        setActionError("No se pudo eliminar la vigilancia. Inténtalo de nuevo.");
      }
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`¿Eliminar la vigilancia de “${task.title}”?`)) void remove();
    } else {
      Alert.alert("Eliminar vigilancia", `¿Quieres eliminar “${task.title}”?`, [
        { text: "Conservar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => void remove() },
      ]);
    }
  };

  const openUrl = async (url?: string | null) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      // Keep the inbox usable if the device has no browser handler.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <SeegsonLogo size={40} />
          <View><Text style={styles.brandName}>SEEGSON</Text><Text style={styles.brandSubtitle}>CENTRO DE AVISOS</Text></View>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>BAJO CONTROL</Text></View>
        </View>

        <View style={styles.introBlock}>
          <Text style={styles.eyebrow}>ALARMAS Y TAREAS</Text>
          <Text style={styles.pageTitle}>Nada importante{"\n"}<Text style={styles.pageTitleAccent}>se queda atrás.</Text></Text>
          <Text style={styles.introText}>Revisa lo programado, cambia la hora o pausa avisos desde un solo lugar.</Text>
        </View>
        {!!actionError && <Text style={styles.formError}>{actionError}</Text>}

        <View style={styles.summaryStrip}>
          <View style={styles.summaryCell}><Text style={styles.summaryNumber}>{recentEvents.filter((event) => event.alarmEnabled).length}</Text><Text style={styles.summaryLabel}>alarmas</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}><Text style={styles.summaryNumber}>{dailyTasks.filter((task) => task.enabled).length}</Text><Text style={styles.summaryLabel}>rutinas</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}><Text style={styles.summaryNumber}>{remoteTasks.filter((task) => task.isEnabled).length}</Text><Text style={styles.summaryLabel}>vigilancias</Text></View>
        </View>

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionEyebrow}>PRÓXIMOS</Text><Text style={styles.sectionTitle}>Eventos y alarmas</Text></View>
          <Text style={styles.sectionCount}>{recentEvents.length}</Text>
        </View>
        {recentEvents.length === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="calendar-clear-outline" size={22} color={colors.teal} /><Text style={styles.emptyTitle}>No hay alarmas pendientes</Text><Text style={styles.emptyText}>Cuando programes eventos, podrás ajustar sus avisos aquí.</Text></View>
        ) : (
          <View style={styles.list}>
            {recentEvents.map((event) => (
              <View key={event.id} style={styles.noticeCard}>
                <View style={styles.noticeIconEvent}><Ionicons name="calendar-outline" size={17} color={colors.amber} /></View>
                <View style={styles.noticeMain}>
                  <Text style={styles.noticeTitle} numberOfLines={1}>{event.title}</Text>
                  <Text style={styles.noticeMeta}>{formatEventDate(event.date)} · evento {event.time}</Text>
                  <Text style={[styles.noticeSubmeta, !event.alarmEnabled && { color: colors.dim }]}>{event.alarmEnabled ? Platform.OS === "web" ? `Solo Android · ${event.alarmTime}` : `Alarma ${event.alarmTime}` : "Alarma desactivada"}</Text>
                </View>
                <Switch value={event.alarmEnabled} onValueChange={() => void toggleEvent(event)} trackColor={{ false: colors.surfaceSoft, true: colors.amberSoft }} thumbColor={event.alarmEnabled ? colors.amber : colors.muted} />
                <Pressable onPress={() => openEditor({ kind: "event", value: event })} style={styles.iconButton} accessibilityLabel="Ajustar alarma"><Ionicons name="time-outline" size={17} color={colors.muted} /></Pressable>
                <Pressable onPress={() => void deleteLocalEventAlarm(event)} style={styles.iconButton} accessibilityLabel="Desactivar alarma"><Ionicons name="close-circle-outline" size={17} color={colors.dim} /></Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionEyebrow}>CADA DÍA</Text><Text style={styles.sectionTitle}>Tareas recurrentes</Text></View>
          <Text style={styles.sectionCount}>{dailyTasks.length}</Text>
        </View>
        {dailyTasks.length === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="repeat-outline" size={21} color={colors.amber} /><Text style={styles.emptyTitle}>Sin recordatorios diarios</Text><Text style={styles.emptyText}>Puedes crear y administrar tus rutinas en la pestaña Agente.</Text></View>
        ) : (
          <View style={styles.list}>
            {dailyTasks.map((task) => (
              <View key={task.id} style={styles.noticeCard}>
                <View style={styles.noticeIconDaily}><Ionicons name="repeat-outline" size={17} color={colors.amber} /></View>
                <View style={styles.noticeMain}><Text style={styles.noticeTitle} numberOfLines={1}>{task.title}</Text><Text style={styles.noticeMeta}>{describeSchedule(task)}</Text><Text style={styles.noticeSubmeta}>{task.enabled ? Platform.OS === "web" ? "Se activará en Android" : "Repetición activa en este Android" : "Tarea pausada"}</Text></View>
                <Switch value={task.enabled} onValueChange={() => void toggleDaily(task)} trackColor={{ false: colors.surfaceSoft, true: colors.amberSoft }} thumbColor={task.enabled ? colors.amber : colors.muted} />
                <Pressable onPress={() => openEditor({ kind: "daily", value: task })} style={styles.iconButton} accessibilityLabel="Editar tarea"><Ionicons name="create-outline" size={17} color={colors.muted} /></Pressable>
                <Pressable onPress={() => void deleteDaily(task)} style={styles.iconButton} accessibilityLabel="Eliminar tarea"><Ionicons name="trash-outline" size={16} color={colors.dim} /></Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionEyebrow}>FUENTES EXTERNAS</Text><Text style={styles.sectionTitle}>Agente de Arch</Text></View>
          <View style={styles.sourceBadge}><View style={styles.liveDot} /><Text style={styles.sourceBadgeText}>ARCH NEWS</Text></View>
        </View>
        {!isAuthenticated && !authLoading ? (
          <View style={styles.signInCard}><Ionicons name="lock-closed-outline" size={19} color={colors.amber} /><Text style={styles.signInTitle}>Inicia sesión para administrar la vigilancia</Text><Pressable onPress={() => void startOAuthLogin()} style={styles.signInButton}><Text style={styles.signInButtonText}>Continuar con Manus</Text><Ionicons name="arrow-forward" size={14} color={colors.background} /></Pressable></View>
        ) : authLoading || tasksQuery.isLoading ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>Cargando vigilancia…</Text></View>
        ) : tasksQuery.isError ? (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No se pudo cargar la vigilancia</Text><Text style={styles.emptyText}>No mostramos un estado vacío porque la consulta falló.</Text><Pressable onPress={() => void tasksQuery.refetch()}><Text style={{ color: colors.teal, marginTop: 10, fontWeight: "800" }}>Reintentar</Text></Pressable></View>
        ) : remoteTasks.length === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="logo-tux" size={22} color={colors.teal} /><Text style={styles.emptyTitle}>Ninguna vigilancia activa</Text><Text style={styles.emptyText}>Configura Arch News en la pestaña Agente para recibir avisos cuando aparezca una noticia nueva.</Text></View>
        ) : (
          <View style={styles.list}>
            {remoteTasks.map((task) => (
              <View key={task.id} style={styles.noticeCard}>
                <View style={styles.noticeIconArch}><Ionicons name="logo-tux" size={17} color={colors.teal} /></View>
                <View style={styles.noticeMain}><Text style={styles.noticeTitle} numberOfLines={1}>{task.title}</Text><Text style={styles.noticeMeta}>Cada día · {task.localTime} ({task.timeZone})</Text><Text style={styles.noticeSubmeta}>{task.isEnabled ? "Vigilancia activa" : "Vigilancia pausada"}</Text></View>
                <Switch value={task.isEnabled} onValueChange={() => void toggleRemote(task)} trackColor={{ false: colors.surfaceSoft, true: colors.tealSoft }} thumbColor={task.isEnabled ? colors.teal : colors.muted} />
                <Pressable onPress={() => openEditor({ kind: "arch", value: task })} style={styles.iconButton} accessibilityLabel="Reprogramar vigilancia"><Ionicons name="time-outline" size={17} color={colors.muted} /></Pressable>
                <Pressable onPress={() => confirmRemoveMonitor(task)} style={styles.iconButton} accessibilityLabel="Eliminar vigilancia"><Ionicons name="trash-outline" size={16} color={colors.dim} /></Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionEyebrow}>ARCH LINUX NEWS</Text><Text style={styles.sectionTitle}>Avisos recibidos</Text></View>
          <Text style={styles.sectionCount}>{alertsQuery.isError ? "!" : alertsQuery.data?.length ?? 0}</Text>
        </View>
        {!isAuthenticated ? (
          <View style={styles.emptyCard}><Ionicons name="mail-unread-outline" size={21} color={colors.teal} /><Text style={styles.emptyText}>Inicia sesión para consultar el historial de avisos del agente.</Text></View>
        ) : alertsQuery.isLoading ? (
          <View style={styles.emptyCard}><Text style={styles.emptyText}>Cargando avisos…</Text></View>
        ) : alertsQuery.isError ? (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No se pudo cargar el historial</Text><Text style={styles.emptyText}>No podemos confirmar si hay avisos nuevos hasta recuperar la conexión.</Text><Pressable onPress={() => void alertsQuery.refetch()}><Text style={{ color: colors.teal, marginTop: 10, fontWeight: "800" }}>Reintentar</Text></Pressable></View>
        ) : (alertsQuery.data?.length ?? 0) === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="checkmark-done-outline" size={21} color={colors.teal} /><Text style={styles.emptyTitle}>Todo al día</Text><Text style={styles.emptyText}>Las noticias nuevas del agente aparecerán aquí.</Text></View>
        ) : (
          <View style={styles.historyList}>
            {alertsQuery.data?.map((item) => (
              <Pressable key={item.id} onPress={() => void openUrl(item.url)} style={styles.historyCard}>
                <View style={styles.historyDot} />
                <View style={styles.historyMain}><Text style={styles.historyTitle}>{item.title}</Text><Text style={styles.historyBody} numberOfLines={2}>{item.body}</Text><Text style={styles.historyDate}>{formatAlertDate(item.createdAt)}</Text></View>
                {!!item.url && <Ionicons name="open-outline" size={15} color={colors.teal} />}
              </Pressable>
            ))}
          </View>
        )}
        <View style={{ height: 25 }} />
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior="padding">
          <Pressable style={styles.modalBackdrop} onPress={() => setEditing(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}><View><Text style={styles.sectionEyebrow}>GESTIONAR AVISO</Text><Text style={styles.modalTitle}>Ajustar programación</Text></View><Pressable onPress={() => setEditing(null)} style={styles.modalClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
            {!!editing && <Text style={styles.editTitle}>{formTitle}</Text>}
            <Text style={styles.fieldLabel}>{editing?.kind === "event" ? "HORA DE ALARMA · DÍA DEL EVENTO" : "HORA DIARIA · HORA LOCAL"}</Text>
            <TextInput value={formTime} onChangeText={setFormTime} placeholder="00:00" placeholderTextColor={colors.dim} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={5} />
            {editing?.kind === "daily" && <><Text style={styles.fieldLabel}>TEXTO DEL RECORDATORIO</Text><TextInput value={formTitle} onChangeText={setFormTitle} placeholder="Qué quieres recordar" placeholderTextColor={colors.dim} style={styles.input} maxLength={120} /></>}
            <View style={styles.enableRow}><View style={{ flex: 1 }}><Text style={styles.enableTitle}>Aviso activo</Text><Text style={styles.enableSubtitle}>{formEnabled ? "Se entregará según lo programado" : "El aviso está pausado"}</Text></View><Switch value={formEnabled} onValueChange={setFormEnabled} trackColor={{ false: colors.surfaceSoft, true: colors.tealSoft }} thumbColor={formEnabled ? colors.teal : colors.muted} /></View>
            {!!formError && <Text style={styles.formError}>{formError}</Text>}
            <Pressable onPress={() => void saveEdit()} disabled={saving} style={[styles.saveButton, saving && { opacity: 0.65 }]}><Text style={styles.saveButtonText}>{saving ? "Guardando…" : "Guardar cambios"}</Text><Ionicons name="arrow-forward" size={16} color={colors.background} /></Pressable>
          </View>
        </KeyboardAvoidingView>
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
  livePill: { marginLeft: "auto", flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 7 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.teal },
  liveText: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  introBlock: { marginTop: 28, marginBottom: 19 },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: "900", letterSpacing: 1.8, marginBottom: 8 },
  pageTitle: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5 },
  pageTitleAccent: { color: colors.amber },
  introText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8, maxWidth: 320 },
  summaryStrip: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginBottom: 25 },
  summaryCell: { flex: 1, alignItems: "center" },
  summaryNumber: { color: colors.text, fontSize: 18, fontWeight: "900" },
  summaryLabel: { color: colors.dim, fontSize: 9, marginTop: 3 },
  summaryDivider: { width: 1, height: 27, backgroundColor: colors.border },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 11, marginTop: 19 },
  sectionEyebrow: { color: colors.dim, fontSize: 9, fontWeight: "900", letterSpacing: 1.6, marginBottom: 5 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  sectionCount: { color: colors.teal, backgroundColor: colors.tealSoft, borderRadius: radii.pill, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: "900" },
  list: { gap: 8 },
  noticeCard: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 11 },
  noticeIconEvent: { width: 33, height: 33, borderRadius: 11, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center" },
  noticeIconDaily: { width: 33, height: 33, borderRadius: 11, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center" },
  noticeIconArch: { width: 33, height: 33, borderRadius: 11, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  noticeMain: { flex: 1, minWidth: 0, marginLeft: 2 },
  noticeTitle: { color: colors.text, fontSize: 10, fontWeight: "800" },
  noticeMeta: { color: colors.muted, fontSize: 8, marginTop: 4 },
  noticeSubmeta: { color: colors.amber, fontSize: 8, marginTop: 3 },
  iconButton: { width: 24, height: 32, alignItems: "center", justifyContent: "center" },
  emptyCard: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 17, paddingVertical: 18 },
  emptyTitle: { color: colors.text, fontSize: 12, fontWeight: "800", textAlign: "center", marginTop: 7 },
  emptyText: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 5, maxWidth: 300 },
  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.tealSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 },
  sourceBadgeText: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  signInCard: { alignItems: "flex-start", gap: 10, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 15 },
  signInTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  signInButton: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.amber, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9 },
  signInButtonText: { color: colors.background, fontSize: 10, fontWeight: "900" },
  historyList: { gap: 8 },
  historyCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.surface, borderRadius: 15, borderWidth: 1, borderColor: colors.border, padding: 12 },
  historyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.teal, marginTop: 5 },
  historyMain: { flex: 1 },
  historyTitle: { color: colors.text, fontSize: 11, fontWeight: "800" },
  historyBody: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  historyDate: { color: colors.dim, fontSize: 8, marginTop: 5 },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.54)" },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Platform.OS === "web" ? 22 : 28 },
  modalHandle: { width: 40, height: 4, borderRadius: 4, backgroundColor: colors.dim, alignSelf: "center", marginBottom: 17 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 17 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  modalClose: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  editTitle: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  fieldLabel: { color: colors.dim, fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginTop: 11, marginBottom: 4 },
  input: { minHeight: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.input, color: colors.text, paddingHorizontal: 13, fontSize: 13 },
  enableRow: { flexDirection: "row", alignItems: "center", marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  enableTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  enableSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  formError: { color: colors.red, fontSize: 10, lineHeight: 15, marginTop: 8 },
  saveButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 49, borderRadius: 15, backgroundColor: colors.amber, marginTop: 16 },
  saveButtonText: { color: colors.background, fontSize: 12, fontWeight: "900" },
});
