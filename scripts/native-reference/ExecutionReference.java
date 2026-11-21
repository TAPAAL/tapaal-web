// Differential reference for design/EXECUTION-CONFORMANCE.md. Builds released TAPAAL model
// objects headlessly (no Animator/GUI) and prints one observation line per scenario op.
// Delay legality mirrors Animator.letTimePass: delay == 0 || (isDelayPossible && no enabled
// urgent transition in an active template, as in Animator.updateFireableTransitions).
//
//   javac -cp "$LIB/*" -d $OUT ExecutionReference.java
//   java -Djava.awt.headless=true -cp "$OUT:$LIB/*" ExecutionReference scenarios.txt
import dk.aau.cs.model.CPN.ColorType;
import dk.aau.cs.model.tapn.*;
import dk.aau.cs.model.tapn.simulation.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;

public class ExecutionReference {
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
    return components.get(p[0]).getPlaceByName(p[1]);
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
    // NetworkMarking.delay/clone keep only active templates; inactive ones are not simulated.
    for (TimedArcPetriNet t : network.activeTemplates())
      for (TimedPlace p : t.places()) {
        List<String> ages = new ArrayList<>();
        for (TimedToken k : p.tokens()) ages.add(k.age().stripTrailingZeros().toPlainString());
        Collections.sort(ages, Comparator.comparing(BigDecimal::new));
        out.add(t.name() + "." + p.name() + "=" + String.join(",", ages));
      }
    return String.join(" ", out);
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
            components.clear();
            System.out.println("case " + a[1]);
          }
          case "component" -> {
            current = new TimedArcPetriNet(a[1]);
            network.add(current);
            current.setActive(a[2].equals("active"));
            components.put(a[1], current);
          }
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
            boolean ok = d.signum() == 0 || (network.marking().isDelayPossible(d) && !urgentEnabled());
            if (ok) network.setMarking(network.marking().delay(d));
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
                FiringMode mode = a[2].equals("youngest") ? new YoungestFiringMode() : new OldestFiringMode();
                next = before.fireTransition(t, mode).value1();
              }
              network.setMarking(next);
              System.out.println("fire " + a[1] + " ok");
            } catch (RuntimeException e) {
              network.setMarking(before);
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
