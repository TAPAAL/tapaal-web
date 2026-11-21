// Differential reference for design/SHARED-PLACES-SIMULATION.md.
// Valid shared-place/local-transition models only; no Animator, GUI tab or file IO.
//   javac -cp "$LIB/*" -d "$OUT" SharedExecutionReference.java
//   java -Djava.awt.headless=true -cp "$OUT:$LIB/*" SharedExecutionReference scenarios.txt
import dk.aau.cs.model.CPN.ColorType;
import dk.aau.cs.model.tapn.*;
import dk.aau.cs.model.tapn.simulation.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;

/** Valid shared-place/local-transition differential. No shared transitions are constructed.
 * ONLY the GUI-dependent NetworkMarking.isDelayPossible predicate is substituted.
 * Delay traversal, token multiplicities/ages, enabling and all firing use released classes.
 * Headless legality adds independent native place-invariant and urgent-transition checks.
 * Runtime ages are constructed directly, never a released-file-IO fidelity claim.
 */
public class SharedExecutionReference {
  static Map<String, SharedPlace> pools = new LinkedHashMap<>();
  static class HeadlessMarking extends NetworkMarking {
    public boolean isDelayPossible(BigDecimal d) {
      if (d.signum() < 0) return false;
      for (var e : getSharedPlacesTokens().entrySet())
        if (network.isSharedPlaceUsedInTemplates((SharedPlace)e.getKey()))
          for (var t : e.getValue()) if (!t.place().invariant().isSatisfied(t.age().add(d))) return false;
      for (var e : getMarkingMap().entrySet())
        if (e.getKey().isActive() && !e.getValue().isDelayPossible(d)) return false;
      return true;
    }
  }
  static void publish(NetworkMarking marking) {
    // Reattach released result to a wrapper because released clone/delay return the base class.
    HeadlessMarking wrapped = new HeadlessMarking();
    wrapped.getSharedPlacesTokens().putAll(marking.getSharedPlacesTokens());
    for (var e : marking.getMarkingMap().entrySet()) wrapped.addMarking(e.getKey(), e.getValue());
    network.setMarking(wrapped);
  }
  static boolean nativeLegality(BigDecimal d) {
    if (d.signum() < 0) return false;
    if (d.signum() > 0 && urgentEnabled()) return false;
    for (var p : pools.values()) if (network.isSharedPlaceUsedInTemplates(p))
      for (var t : p.tokens()) if (!p.invariant().isSatisfied(t.age().add(d))) return false;
    for (var c : network.activeTemplates()) for (var p : c.places()) if (!p.isShared())
      for (var t : p.tokens()) if (!p.invariant().isSatisfied(t.age().add(d))) return false;
    return true;
  }
  static TimedArcPetriNetNetwork network;
  static TimedArcPetriNet current;
  static Map<String, TimedArcPetriNet> components = new LinkedHashMap<>();

  static Bound bound(String s) {
    return s.equals("inf") ? Bound.Infinity : new IntBound(Integer.parseInt(s));
  }
  static TimeInterval interval(String s) {
    String[] p = s.substring(1, s.length() - 1).split(",");
    return new TimeInterval(s.startsWith("["), bound(p[0]), bound(p[1]), s.endsWith("]"));
  }
  static TimeInvariant invariant(String s) {
    if (s.equals("inf")) return TimeInvariant.LESS_THAN_INFINITY;
    boolean closed = s.startsWith("<=");
    return new TimeInvariant(closed, bound(s.substring(closed ? 2 : 1)));
  }
  static TimedPlace place(String qualified) {
    String[] p = qualified.split("\\.");
    return p[0].equals("global") ? pools.get(p[1]) : components.get(p[0]).getPlaceByName(p[1]);
  }
  static TimedTransition transition(String qualified) {
    String[] p = qualified.split("\\.");
    return components.get(p[0]).getTransitionByName(p[1]);
  }
  static boolean urgentEnabled() {
    for (TimedArcPetriNet t : network.activeTemplates())
      for (TimedTransition tr : t.transitions()) if (tr.isUrgent() && tr.isEnabled()) return true;
    return false;
  }
  static String marking() {
    List<String> out = new ArrayList<>();
    for (var p : pools.values()) out.add("global." + p.name() + "=" + ages(p));
    for (TimedArcPetriNet t : network.activeTemplates())
      for (TimedPlace p : t.places()) if (!p.isShared()) out.add(t.name() + "." + p.name() + "=" + ages(p));
    return String.join(" ", out);
  }
  static String ages(TimedPlace p) {
    List<String> ages = new ArrayList<>();
    for (var token : (p.isShared() ? network.marking().getTokensFor(p) : p.tokens())) ages.add(token.age().stripTrailingZeros().toPlainString());
    Collections.sort(ages, Comparator.comparing(BigDecimal::new));
    return String.join(",", ages);
  }
  public static void main(String[] args) throws Exception {
    for (String raw : Files.readAllLines(Path.of(args[0]))) {
      String line = raw.trim();
      if (line.isEmpty() || line.startsWith("#")) continue;
      String[] a = line.split("\\s+");
      try {
        switch (a[0]) {
          case "case" -> {
            network = new TimedArcPetriNetNetwork();
            components.clear(); pools.clear(); publish(network.marking());
            System.out.println("case " + a[1]);
          }
          case "component" -> {
            current = new TimedArcPetriNet(a[1]);
            network.add(current);
            current.setActive(a[2].equals("active"));
            components.put(a[1], current);
          }
          case "shared" -> { var p = new SharedPlace(a[1]); p.setInvariant(invariant(a[2])); network.add(p); pools.put(a[1], p); }
          case "member" -> current.add(pools.get(a[1]));
          case "place" -> current.add(new LocalTimedPlace(a[1], invariant(a[2]), ColorType.COLORTYPE_DOT));
          case "trans" -> current.add(new TimedTransition(a[1], a[2].equals("urgent"), null));
          case "in" -> current.add(new TimedInputArc(current.getPlaceByName(a[1]), current.getTransitionByName(a[2]), interval(a[3]), new IntWeight(Integer.parseInt(a[4])), null));
          case "out" -> current.add(new TimedOutputArc(current.getTransitionByName(a[1]), current.getPlaceByName(a[2]), new IntWeight(Integer.parseInt(a[3])), null));
          case "inh" -> current.add(new TimedInhibitorArc(current.getPlaceByName(a[1]), current.getTransitionByName(a[2]), TimeInterval.ZERO_INF, new IntWeight(Integer.parseInt(a[3])), null));
          case "transport" -> {
            TransportArc arc = new TransportArc(current.getPlaceByName(a[1]), current.getTransitionByName(a[2]), current.getPlaceByName(a[3]), interval(a[4]));
            // Null-expression constructors reset weight to 1; TapnXmlLoader passes expressions instead.
            arc.setWeight(new IntWeight(Integer.parseInt(a[5])));
            current.add(arc);
          }
          case "token" -> {
            TimedPlace p = place(a[1]);
            p.addToken(new TimedToken(p, new BigDecimal(a[2]), ColorType.COLORTYPE_DOT.getFirstColor()));
          }
          case "enabled" -> {
            List<String> names = new ArrayList<>();
            for (TimedArcPetriNet t : network.activeTemplates())
              for (TimedTransition tr : t.transitions()) if (tr.isEnabled()) names.add(t.name() + "." + tr.name());
            Collections.sort(names);
            System.out.println("enabled " + String.join(",", names));
          }
          case "delay" -> {
            BigDecimal d = new BigDecimal(a[1]);
            boolean ok = network.marking().isDelayPossible(d) && (d.signum() == 0 || !urgentEnabled());
            if (ok != nativeLegality(d)) throw new AssertionError("independent native legality disagrees");
            if (ok) publish(network.marking().delay(d));
            System.out.println("delay " + a[1] + " " + (ok ? "ok" : "blocked"));
          }
          case "fire" -> {
            TimedTransition t = transition(a[1]);
            NetworkMarking before = network.marking();
            // Animator.updateFireableTransitions only offers transitions of active templates.
            if (!t.model().isActive()) {
              System.out.println("fire " + a[1] + " error");
              continue;
            }
            try {
              NetworkMarking next;
              if (a[2].startsWith("manual:")) {
                List<TimedToken> chosen = new ArrayList<>();
                for (String ref : a[2].substring(7).split(";")) {
                  String[] pa = ref.split("@");
                  TimedToken match = null;
                  for (TimedToken k : place(t.model().name() + "." + pa[0]).tokens())
                    if (k.age().compareTo(new BigDecimal(pa[1])) == 0 && !chosen.contains(k)) { match = k; break; }
                  if (match == null) throw new IllegalArgumentException("absent manual token");
                  chosen.add(match);
                }
                if (!t.isEnabled()) throw new IllegalStateException("disabled");
                next = before.fireTransition(t, chosen);
              } else {
                if (!t.isEnabled()) throw new IllegalStateException("disabled");
                FiringMode mode = a[2].equals("random") ? new RandomFiringMode() : a[2].equals("youngest") ? new YoungestFiringMode() : new OldestFiringMode();
                next = before.fireTransition(t, mode).value1();
              }
              publish(next);
              System.out.println("fire " + a[1] + " ok");
            } catch (RuntimeException e) {
              publish(before);
              System.out.println("fire " + a[1] + " error");
            }
          }
          case "marking" -> System.out.println("marking " + marking());
          default -> throw new IllegalArgumentException("Unknown op " + a[0]);
        }
      } catch (RuntimeException e) {
        System.out.println("harness-error " + line + " :: " + e);
      }
    }
  }
}
