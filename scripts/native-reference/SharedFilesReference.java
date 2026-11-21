import dk.aau.cs.io.*;
import dk.aau.cs.model.tapn.*;
import java.io.File;
import net.tapaal.gui.petrinet.Template;

/** Released loader/writer assertions, without a frame, tab, Animator or substituted engine.
 * Swing transport construction needs xvfb; this does not exercise the desktop GUI.
 * Only zero-age files are conformance inputs: released 4.0.4 nonzero-age IO is excluded.
 */
public class SharedFilesReference {
  static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
  public static void main(String[] args) {
    try {
      LoadedModel model = new TapnXmlLoader().load(new File(args[0]));
      check(model != null, "loader returned null");
      TimedPlace pool = model.network().getSharedPlaceByName("Pool");
      TimedPlace unused = model.network().getSharedPlaceByName("Unused");
      check(pool != null && unused != null, "missing pools");
      check(pool.numberOfTokens() == 3 && unused.numberOfTokens() == 1, "global counts");
      check(pool.invariant().upperBound() instanceof ConstantBound, "symbolic pool invariant");
      check(unused.invariant().upperBound() instanceof ConstantBound, "symbolic zero invariant");
      int members = 0, transports = 0, inhibitors = 0;
      for (Template template : model.templates()) {
        TimedArcPetriNet net = template.model();
        if (net.getPlaceByName("Pool") != null) {
          check(net.getPlaceByName("Pool") == pool, "member must alias global pool");
          members++;
        }
        if (net.name().equals("Beta")) check(!template.isActive(), "inactive member");
        for (TransportArc arc : net.transportArcs()) {
          check(arc.source() == pool, "transport source alias");
          check(arc.getWeight().value() == 2, "weighted transport");
          check(arc.getWeight() instanceof ConstantWeight, "symbolic transport weight");
          transports++;
        }
        for (TimedInhibitorArc arc : net.inhibitorArcs()) {
          check(arc.source() == pool && arc.getWeight().value() == 2, "weighted shared inhibitor");
          inhibitors++;
        }
      }
      check(members == 2 && transports == 1 && inhibitors == 1, "topology");
      new TimedArcPetriNetNetworkWriter(model.network(), model.templates(), model.queries(),
          model.network().constants(), model.getLens()).savePNML(new File(args[1]));
      System.out.println("PASS released shared loader/writer: pools, aliases, unused state, inactive member, symbolic invariants, weighted transport/inhibitor");
      System.exit(0);
    } catch (Throwable error) {
      error.printStackTrace();
      System.exit(1);
    }
  }
}
